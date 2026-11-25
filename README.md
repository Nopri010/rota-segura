# Rota Segura

Protótipo com Arduino Uno e Raspberry para monitorar dois trechos e indicar uma rota disponível. O Arduino lê os sensores e controla LEDs e cancelas. A Raspberry recebe os dados por USB, guarda o histórico em SQLite e disponibiliza o painel na rede local.

## Montagem

| Componente | Trecho A | Trecho B |
| --- | --- | --- |
| Sensor de distância: Trig | D7 | D2 |
| Sensor de distância: Echo | D8 | D11 |
| LED verde | D3 | D5 |
| LED vermelho | D4 | D6 |
| Sinal do servo SG90 | D9 | D10 |

O sensor de temperatura e umidade está configurado como DHT11, com dados em D12. Cada LED usa um resistor em série. O cabo USB conecta o Arduino à Raspberry; não são usados os GPIO da Raspberry nessa comunicação. Os servos precisam de alimentação adequada e GND comum com o Arduino.

## Arduino

Abra `firmware/rota_segura/rota_segura.ino` no Arduino IDE e selecione **Arduino Uno**.

Instale pelo gerenciador de bibliotecas:

- Servo
- DHT sensor library, da Adafruit
- Adafruit Unified Sensor
- ArduinoJson **6.21.5**

Carregue o programa na placa. O Monitor Serial usa **115200 baud**; feche-o antes de iniciar o leitor na Raspberry.

A configuração padrão é teste seco: objeto a até 10 cm bloqueia o trecho; a liberação exige oito leituras consecutivas acima de 12 cm, cerca de 2 segundos. Sem leitura válida, o trecho fica indisponível. A leitura do DHT é feita com os pulsos dos servos suspensos para evitar conflito com as interrupções do Timer1.

Para medir nível de água, é necessário calibrar as referências no firmware antes de desativar `TESTE_SECO`. Os valores de referência que vêm no arquivo são exemplos.

## Raspberry

Requisitos: Python 3.10 ou superior, suporte a `venv` e acesso à porta serial.

```bash
git clone https://github.com/Nopri010/rota-segura.git ~/rota-segura
cd ~/rota-segura
python3 -m venv .venv
.venv/bin/python -m pip install -r painel/requirements.txt
ls -l /dev/serial/by-id/
```

Inicie com a porta encontrada. Exemplo:

```bash
.venv/bin/python -m painel.app --modo real --porta /dev/ttyACM0 --host 0.0.0.0 --port 5000
```

Pode usar o caminho completo de `/dev/serial/by-id/` no lugar de `/dev/ttyACM0`. Se faltar `venv`, instale `python3-venv` pelo gerenciador do sistema. Se houver erro de permissão na serial, confira o grupo da porta; no Raspberry Pi OS, normalmente é necessário estar no grupo `dialout` e entrar novamente na sessão.

No notebook ou celular na mesma rede, abra `http://IP_DA_RASPBERRY:5000`. Use `hostname -I` na Raspberry para consultar o IP.

## Início automático

O serviço abaixo considera o projeto em `~/rota-segura`. Confira `Environment=PORTA_ARDUINO` em `deploy/rota-segura.service` e ajuste para a porta encontrada.

Encerre a execução manual com Ctrl+C antes de iniciar o serviço.

```bash
mkdir -p ~/.config/systemd/user
cp deploy/rota-segura.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now rota-segura.service
sudo loginctl enable-linger "$USER"
```

Para conferir ou reiniciar:

```bash
systemctl --user status rota-segura.service --no-pager
systemctl --user restart rota-segura.service
```

## Painel

- A livre: indica A. Se A estiver bloqueado ou indisponível e B livre, indica B.
- Nenhum trecho livre: não indica rota.
- Sem mensagem válida por 3 segundos: oculta a rota.
- Temperatura e umidade são exibidas, mas não decidem o bloqueio.
- O mapa usa ruas fictícias e não depende de serviço externo de mapas.
- A página mostra o comando da cancela; a posição física é conferida na bancada.

O histórico fica em `painel/dados/real.sqlite3`, criado na primeira execução. O leitor continua funcionando com o navegador fechado. A página consulta `/api/estado` e `/api/historico`; não envia comandos de atuação.

Para testar a página sem Arduino:

```bash
.venv/bin/python -m painel.app --modo simulado
```

O modo simulado usa os exemplos de `referencias/cenarios_painel.ndjson` e um banco separado. Não há troca automática entre dados reais e simulados.

## Tecnologias

C++ no Arduino; Python, pyserial, Flask e Waitress na Raspberry; SQLite para o histórico; HTML, CSS, JavaScript e Canvas no painel.

O projeto demonstra o conceito em bancada. O teste seco não representa medição calibrada de enchente nem validação para uso em vias reais.
