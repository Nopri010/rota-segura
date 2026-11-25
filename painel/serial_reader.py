"""NDJSON validado, estado atual e historico de transicoes. Sem acesso web de escrita."""
import copy
import json
import logging
import math
from pathlib import Path
import sqlite3
import threading
import time
from datetime import datetime, timezone

ESTADOS = {"LIVRE", "BLOQUEADO", "SENSOR_INDISPONIVEL"}
MAX_LINHA = 1024


def validar_linha(linha):
    if len(linha) > MAX_LINHA:
        raise ValueError("linha muito longa")
    try:
        obj = json.loads(linha)
        if not isinstance(obj, dict) or type(obj.get("v")) is not int or obj["v"] != 1:
            raise ValueError("versao invalida")
        if obj.get("tipo") == "pong":
            if type(obj.get("id")) is not int or not 0 <= obj["id"] <= 4294967295:
                raise ValueError("pong invalido")
            return {"v": 1, "tipo": "pong", "id": obj["id"]}
        if obj.get("tipo") != "estado":
            raise ValueError("tipo invalido")
        for campo in ("seq", "uptime_ms"):
            if type(obj.get(campo)) is not int or not 0 <= obj[campo] <= 4294967295:
                raise ValueError("contador invalido")
        result = {k: obj[k] for k in ("v", "tipo", "seq", "uptime_ms")}
        teste_seco = obj.get("teste_seco", False)
        if type(teste_seco) is not bool:
            raise ValueError("indicador de teste seco invalido")
        if "teste_seco" in obj:
            result["teste_seco"] = teste_seco
        if "sensor_ambiente" in obj:
            if obj["sensor_ambiente"] not in ("DHT11", "DHT22"):
                raise ValueError("tipo de sensor ambiental invalido")
            result["sensor_ambiente"] = obj["sensor_ambiente"]
        result["trechos"] = {}
        for nome in ("A", "B"):
            t = obj["trechos"][nome]
            estado = t["estado"]
            comando = "ABRIR" if estado == "LIVRE" else "FECHAR"
            if estado not in ESTADOS or t["cancela_comando"] != comando:
                raise ValueError("estado ou comando incoerente")
            valores = {}
            for campo in ("dist_cm", "nivel_cm"):
                n = t[campo]
                if n is not None and (type(n) not in (int, float) or not math.isfinite(n) or not 0 <= n <= 400):
                    raise ValueError("medida invalida")
                valores[campo] = n
            if teste_seco and valores["nivel_cm"] is not None:
                raise ValueError("teste seco nao fornece nivel de agua")
            if estado != "SENSOR_INDISPONIVEL" and (valores["dist_cm"] is None or (not teste_seco and valores["nivel_cm"] is None)):
                raise ValueError("trecho operacional sem medida")
            valores.update(estado=estado, cancela_comando=comando)
            if "calibrado" in t:
                if type(t["calibrado"]) is not bool or (not t["calibrado"] and not teste_seco and estado != "SENSOR_INDISPONIVEL"):
                    raise ValueError("calibracao incoerente")
                valores["calibrado"] = t["calibrado"]
            result["trechos"][nome] = valores
        result["ambiente"] = {}
        for campo, minimo, maximo in (("temp_c", -40, 80), ("umidade_pct", 0, 100)):
            n = obj["ambiente"][campo]
            if n is not None and (type(n) not in (int, float) or not math.isfinite(n) or not minimo <= n <= maximo):
                raise ValueError("ambiente invalido")
            result["ambiente"][campo] = n
        if "servos_habilitados" in obj:
            if type(obj["servos_habilitados"]) is not bool:
                raise ValueError("indicador dos servos invalido")
            result["servos_habilitados"] = obj["servos_habilitados"]
        return result
    except (KeyError, TypeError, UnicodeError, OverflowError) as exc:
        raise ValueError("estrutura invalida") from exc


class Monitor:
    def __init__(self, banco, modo, prazo=3.0, relogio=time.monotonic):
        if modo not in ("real", "simulado") or prazo <= 0:
            raise ValueError("configuracao invalida")
        Path(banco).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(banco), check_same_thread=False)
        self.db.execute("CREATE TABLE IF NOT EXISTS eventos (id INTEGER PRIMARY KEY, hora TEXT, modo TEXT, alvo TEXT, estado TEXT, dist_cm REAL, nivel_cm REAL)")
        if "teste_seco" not in {coluna[1] for coluna in self.db.execute("PRAGMA table_info(eventos)")}:
            # Registros antigos ficam NULL: nao inferimos o tipo de ensaio passado.
            self.db.execute("ALTER TABLE eventos ADD COLUMN teste_seco INTEGER")
        self.db.commit()
        self.lock = threading.RLock()
        self.modo, self.prazo, self.relogio = modo, prazo, relogio
        self.atual = None
        self.recebido = None
        self.hora = None
        self.online = False
        self.anteriores = {}
        self.pong = None
        self.teste_seco = None

    def _evento(self, alvo, estado, dados=None):
        dados = dados or {}
        self.db.execute("INSERT INTO eventos(hora,modo,alvo,estado,dist_cm,nivel_cm,teste_seco) VALUES(?,?,?,?,?,?,?)",
                        (datetime.now(timezone.utc).isoformat(), self.modo, alvo, estado, dados.get("dist_cm"), dados.get("nivel_cm"), self.teste_seco))

    def _verificar_prazo(self):
        if self.online and self.relogio() - self.recebido >= self.prazo:
            self.online = False
            self._evento("COMUNICACAO", "INTERROMPIDA")
            self.db.commit()

    def ingerir(self, linha):
        msg = validar_linha(linha)
        with self.lock:
            self._verificar_prazo()
            if msg["tipo"] == "pong":
                self.pong = {"id": msg["id"], "hora": datetime.now(timezone.utc).isoformat()}
                return
            novo_teste_seco = msg.get("teste_seco", False)
            mudou_ensaio = self.atual is not None and novo_teste_seco != self.teste_seco
            self.teste_seco = novo_teste_seco
            if mudou_ensaio:
                self.anteriores.clear()
                self._evento("ENSAIO", "TESTE_SECO" if novo_teste_seco else "NIVEL_AGUA")
            if not self.online:
                self._evento("COMUNICACAO", "ATIVA")
            for nome, dados in msg["trechos"].items():
                if self.anteriores.get(nome) != dados["estado"]:
                    self._evento(nome, dados["estado"], dados)
                    self.anteriores[nome] = dados["estado"]
            self.online = True
            self.atual = msg
            self.recebido = self.relogio()
            self.hora = datetime.now(timezone.utc).isoformat()
            self.db.commit()

    def verificar_prazo(self):
        with self.lock:
            self._verificar_prazo()

    def desconectar(self):
        with self.lock:
            if self.online:
                self.online = False
                self._evento("COMUNICACAO", "INTERROMPIDA")
                self.db.commit()

    def estado(self):
        with self.lock:
            self._verificar_prazo()
            rota = None
            if self.online:
                rota = next((n for n in ("A", "B") if self.atual["trechos"][n]["estado"] == "LIVRE"), None)
            return {"modo": self.modo, "comunicacao": "ATIVA" if self.online else "SEM_DADOS",
                    "rota": rota, "ultima_atualizacao": self.hora,
                    "idade_s": None if self.recebido is None else round(self.relogio() - self.recebido, 2),
                    "prazo_s": self.prazo, "telemetria": copy.deepcopy(self.atual), "ultimo_pong": copy.deepcopy(self.pong)}

    def historico(self):
        with self.lock:
            cursor = self.db.execute("SELECT hora,modo,alvo,estado,dist_cm,nivel_cm,teste_seco FROM eventos WHERE modo=? ORDER BY id DESC LIMIT 50", (self.modo,))
            nomes = [c[0] for c in cursor.description]
            return [dict(zip(nomes, r)) for r in cursor.fetchall()]


def executar_serial(monitor, porta, parar):
    import serial
    ping = 0
    while not parar.is_set():
        try:
            # Timeout curto permite detectar desatualizacao sem navegador aberto.
            with serial.Serial(porta, 115200, timeout=0.25, write_timeout=1) as usb:
                buffer = bytearray()
                descartando = False
                proximo_ping = time.monotonic() + 2
                while not parar.is_set():
                    parte = usb.read(min(usb.in_waiting or 1, 256))
                    for byte in parte:
                        if byte == 10:
                            if buffer and not descartando:
                                try:
                                    monitor.ingerir(bytes(buffer))
                                except (ValueError, UnicodeError):
                                    logging.warning("Linha serial invalida descartada")
                            buffer.clear()
                            descartando = False
                        elif not descartando:
                            if len(buffer) >= MAX_LINHA:
                                buffer.clear()
                                descartando = True
                            else:
                                buffer.append(byte)
                    monitor.verificar_prazo()
                    if time.monotonic() >= proximo_ping:
                        ping = (ping + 1) % 4294967296
                        usb.write((json.dumps({"tipo": "ping", "id": ping}) + "\n").encode())
                        proximo_ping = time.monotonic() + 5
        except (serial.SerialException, OSError):
            logging.warning("Serial indisponivel; nova tentativa em 2 s")
            monitor.desconectar()
            parar.wait(2)


def executar_replay(monitor, arquivo, parar):
    # Fim de cada ciclo deixa >3s sem estado para exercitar o aviso de comunicacao.
    linhas = Path(arquivo).read_text(encoding="utf-8").splitlines()
    while not parar.is_set():
        for linha in linhas:
            try:
                monitor.ingerir(linha)
            except ValueError:
                logging.warning("Exemplo invalido descartado")
            if parar.wait(2):
                return
            monitor.verificar_prazo()
        for _ in range(20):
            if parar.wait(0.25):
                return
            monitor.verificar_prazo()
