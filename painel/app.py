"""Servidor do painel e leitura do Arduino por USB."""
import argparse
import logging
from pathlib import Path
import threading
from flask import Flask, jsonify, render_template
from waitress import serve
from .serial_reader import Monitor, executar_replay, executar_serial

ROOT = Path(__file__).resolve().parent.parent


def criar_app(monitor):
    app = Flask(__name__)

    @app.get("/")
    def inicio():
        return render_template("index.html")

    @app.get("/api/estado")
    def estado():
        resposta = jsonify(monitor.estado())
        resposta.headers["Cache-Control"] = "no-store"
        return resposta

    @app.get("/api/historico")
    def historico():
        resposta = jsonify(monitor.historico())
        resposta.headers["Cache-Control"] = "no-store"
        return resposta

    return app


def main():
    parser = argparse.ArgumentParser(description="Painel local Rota Segura")
    parser.add_argument("--modo", required=True, choices=("simulado", "real"))
    parser.add_argument("--porta", help="COM3 no Windows; /dev/serial/by-id/... na Pi")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=5000, type=int)
    args = parser.parse_args()
    if args.modo == "real" and not args.porta:
        parser.error("modo real exige --porta; nao existe troca automatica para simulacao")
    logging.basicConfig(level=logging.INFO)
    monitor = Monitor(ROOT / "painel" / "dados" / f"{args.modo}.sqlite3", args.modo)
    parar = threading.Event()
    alvo = executar_serial if args.modo == "real" else executar_replay
    origem = args.porta if args.modo == "real" else ROOT / "referencias" / "cenarios_painel.ndjson"
    worker = threading.Thread(target=alvo, args=(monitor, origem, parar), daemon=True)
    worker.start()
    try:
        logging.info("Painel: http://%s:%s | modo=%s", args.host, args.port, args.modo)
        serve(criar_app(monitor), host=args.host, port=args.port, threads=4)
    finally:
        parar.set()
        worker.join(timeout=3)


if __name__ == "__main__":
    main()
