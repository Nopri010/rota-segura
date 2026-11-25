/* Sem comandos de atuacao no navegador. O Arduino decide os estados. */
const el = id => document.getElementById(id);
const fmt = n => typeof n === 'number' && Number.isFinite(n) ? n.toFixed(1).replace('.', ',') + ' cm' : 'indisponível';
const nomes = {LIVRE: 'LIVRE', BLOQUEADO: 'BLOQUEADO', SENSOR_INDISPONIVEL: 'SENSOR INDISPONÍVEL'};
let ultimaResposta = null;
let ultimoSucesso = 0;

function renderizar(resposta, falhaWeb = false) {
  const vivo = !falhaWeb && resposta?.comunicacao === 'ATIVA';
  const t = resposta?.telemetria;
  const seco = t?.teste_seco === true;
  const rota = vivo ? resposta.rota : null;
  const estados = ['A', 'B'].map(n => vivo ? t.trechos[n].estado : 'SEM DADOS');
  el('headline').textContent = !vivo ? 'Comunicação interrompida' : rota ? 'Trajeto pelo trecho ' + rota : 'Nenhuma rota disponível';
  el('detail').textContent = !vivo ? 'Aguarde uma nova leitura válida antes de indicar um caminho.' : rota ? 'O caminho indicado passa por um trecho com leitura válida e estado livre.' : 'Os trechos estão bloqueados ou sem leitura válida.';
  el('mode').textContent = resposta?.modo === 'simulado' ? 'SIMULAÇÃO · DADOS FICTÍCIOS' : resposta?.modo === 'real' ? (seco ? 'USB · TESTE SECO' : 'LEITURA POR USB') : 'AGUARDANDO DADOS';
  const motorDesligado = t?.servos_habilitados === false;
  el('warning').textContent = !vivo ? (falhaWeb ? 'Sem resposta do painel da Raspberry. A rota foi ocultada.' : 'Sem telemetria recente do Arduino. Últimas leituras, quando presentes, estão desatualizadas.') : resposta.modo === 'simulado' ? 'Simulação para testar o software. Estes valores não comprovam ensaio físico.' : motorDesligado ? 'Motores desativados no programa. Os comandos abaixo representam apenas a decisão lógica.' : 'Leituras recebidas por USB. Confira visualmente o movimento das cancelas.';
  if (vivo && seco && resposta.modo === 'real') el('warning').textContent = 'Teste seco com objeto: o bloqueio depende da distância. Nível de água não calculado.' + (motorDesligado ? ' Motores desativados.' : ' Confira o movimento das cancelas.');
  ['A', 'B'].forEach((n, i) => {
    const id = n.toLowerCase(), dados = t?.trechos[n];
    el('state-' + id).textContent = vivo ? nomes[estados[i]] : 'SEM DADOS';
    el('state-' + id).className = 'state' + (estados[i] === 'LIVRE' ? '' : estados[i] === 'BLOQUEADO' ? ' blocked' : ' unknown');
    el('reading-' + id).textContent = seco ? 'Teste seco: nível de água não calculado' : (vivo ? 'Nível estimado: ' : 'Último nível recebido: ') + fmt(dados?.nivel_cm);
    el('distance-' + id).textContent = (vivo ? 'Distância: ' : 'Última distância: ') + fmt(dados?.dist_cm) + (dados?.calibrado === false && !seco ? ' · falta calibrar' : '');
    el('servo-' + id).textContent = !vivo ? 'Cancela: comando atual desconhecido' : motorDesligado ? 'Motor desativado · decisão: ' + dados.cancela_comando : 'Cancela: ' + (dados.cancela_comando === 'ABRIR' ? 'abertura comandada' : 'fechamento comandado');
    el('gate-' + id).dataset.command = !vivo || motorDesligado ? 'DESCONHECIDO' : dados.cancela_comando;
  });
  const ar = t?.ambiente;
  const ambiente = ar ? (ar.temp_c === null ? 'Temperatura indisponível' : ar.temp_c.toFixed(1).replace('.', ',') + ' °C') + ' · ' + (ar.umidade_pct === null ? 'Umidade indisponível' : ar.umidade_pct.toFixed(1).replace('.', ',') + '% UR') : 'Indisponíveis';
  el('environment').textContent = (vivo ? '' : 'Última leitura: ') + ambiente;
  el('serial').classList.toggle('down', !vivo);
  el('serial').querySelector('span').textContent = vivo ? 'Arduino → Raspberry · dados recentes' : 'Sem comunicação atual';
  el('clock').textContent = resposta?.ultima_atualizacao ? 'Último recebimento: ' + new Date(resposta.ultima_atualizacao).toLocaleTimeString('pt-BR') : 'Sem leitura recebida';
  el('ping').textContent = resposta?.ultimo_pong ? 'Resposta ao teste de comunicação nº ' + resposta.ultimo_pong.id + ' às ' + new Date(resposta.ultimo_pong.hora).toLocaleTimeString('pt-BR') : 'Aguardando resposta ao teste de comunicação';
  drawMap({route: rota, states: estados, headline: el('headline').textContent, detail: el('detail').textContent});
}

async function buscar(url) {
  const r = await fetch(url, {cache: 'no-store', signal: AbortSignal.timeout(1800)});
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function consultarEstado() {
  try {
    ultimaResposta = await buscar('/api/estado');
    ultimoSucesso = performance.now();
    renderizar(ultimaResposta);
  } catch {
    renderizar(ultimaResposta, true);
  } finally {
    setTimeout(consultarEstado, 750);
  }
}

async function consultarHistorico() {
  try {
    const eventos = await buscar('/api/historico');
    const tbody = el('events');
    tbody.replaceChildren();
    for (const evento of eventos) {
      const tr = document.createElement('tr');
      for (const texto of [new Date(evento.hora).toLocaleString('pt-BR'), evento.alvo === 'COMUNICACAO' ? 'Comunicação' : evento.alvo === 'ENSAIO' ? 'Ensaio' : 'Trecho ' + evento.alvo, (nomes[evento.estado] || evento.estado) + (evento.modo === 'simulado' ? ' · simulado' : '') + (evento.teste_seco === 1 ? ' · teste seco' : ''), evento.teste_seco === 1 ? 'Não calculado' : fmt(evento.nivel_cm)]) {
        const td = document.createElement('td'); td.textContent = texto; tr.append(td);
      }
      tbody.append(tr);
    }
    if (!eventos.length) { const tr = document.createElement('tr'), td = document.createElement('td'); td.colSpan = 4; td.textContent = 'Nenhuma transição registrada'; tr.append(td); tbody.append(tr); }
  } catch { /* O estado e o aviso de comunicacao continuam independentes. */ }
  finally { setTimeout(consultarHistorico, 2000); }
}

// Oculta o trajeto tambem se o servidor web parar e nenhuma resposta chegar.
setInterval(() => { if (performance.now() - ultimoSucesso >= 3000) renderizar(ultimaResposta, true); }, 250);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && performance.now() - ultimoSucesso >= 3000) renderizar(ultimaResposta, true);
});
renderizar(null, true);
consultarEstado();
consultarHistorico();
