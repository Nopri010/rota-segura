// Rota Segura - Arduino Uno. Comunicacao serial USB: 115200 baud.

#include <Servo.h>
#include <DHT.h>
#include <ArduinoJson.h>
// TESTE SECO: true = livro/objeto. false = nivel de agua com calibracao medida.
const bool TESTE_SECO = true;
const float DISTANCIA_FECHAR_CM = 10.0f;  // Fecha quando distancia <= 10 cm.
const float DISTANCIA_REABRIR_CM = 12.0f; // Abre quando distancia > 12 cm, 8 vezes no teste seco.
const byte TIPO_SENSOR_AMBIENTE = DHT11;  // Modelo do sensor de temperatura e umidade.

// Referencias do modo agua: medir e calibrar antes de habilitar.
const bool CALIBRADO_A = false;
const bool CALIBRADO_B = false;
const float REFERENCIA_A_CM = 18.0f;  // Face do sensor ate o nivel zero.
const float REFERENCIA_B_CM = 18.0f;
const float BLOQUEAR_CM = 8.0f;
const float REABRIR_CM = 6.0f;  // Reabre somente ABAIXO deste valor.

// Posicoes das cancelas e habilitacao dos motores.
const bool HABILITAR_SERVOS = true;
const byte ANGULO_ABERTO_A = 90;
const byte ANGULO_FECHADO_A = 0;
const byte ANGULO_ABERTO_B = 90;
const byte ANGULO_FECHADO_B = 0;

#include <math.h>

enum EstadoTrecho { LIVRE, BLOQUEADO, SENSOR_INDISPONIVEL };

struct ControleTrecho {
  EstadoTrecho estado = SENSOR_INDISPONIVEL;
  unsigned char baixas = 0;

  // Falha invalida imediatamente. Recuperacao seca: 8 leituras; agua: 3.
  void atualizar(float medida, bool valido, float fechar, float reabrir, bool porDistancia = false) {
    if (!valido || !isfinite(medida)) {
      estado = SENSOR_INDISPONIVEL;
      baixas = 0;
      return;
    }
    if (porDistancia ? medida <= fechar : medida >= fechar) {
      estado = BLOQUEADO;
      baixas = 0;
    } else if (porDistancia ? medida > reabrir : medida < reabrir) {
      const unsigned char minimoLivres = porDistancia ? 8 : 3;
      if (baixas < minimoLivres) ++baixas;
      if (baixas >= minimoLivres) estado = LIVRE;
    } else {
      baixas = 0;
      if (estado == SENSOR_INDISPONIVEL) estado = BLOQUEADO;
    }
  }
};

const byte TRIG[2] = {7, 2}, ECHO[2] = {8, 11};
const byte VERDE[2] = {3, 5}, VERMELHO[2] = {4, 6};
const byte SERVO_PIN[2] = {9, 10};
const float REFERENCIA[2] = {REFERENCIA_A_CM, REFERENCIA_B_CM};
const bool CALIBRADO[2] = {CALIBRADO_A, CALIBRADO_B};
const byte ABERTO[2] = {ANGULO_ABERTO_A, ANGULO_ABERTO_B};
const byte FECHADO[2] = {ANGULO_FECHADO_A, ANGULO_FECHADO_B};
Servo motores[2];
DHT ambiente(12, TIPO_SENSOR_AMBIENTE);
ControleTrecho controle[2];
float distancia[2] = {NAN, NAN}, nivel[2] = {NAN, NAN};
float temperatura = NAN, umidade = NAN;
unsigned long ultimaMedida = 0, ultimoEnvio = 0, ultimoAmbiente = 0, seq = 0;
byte proximoSensor = 0;
char entrada[96];
byte tamanhoEntrada = 0;
bool descartarEntrada = false;

void numero(float n) {
  if (isfinite(n)) Serial.print(n, 1);
  else Serial.print(F("null"));
}

void atuar(byte i) {
  bool livre = controle[i].estado == LIVRE;
  digitalWrite(VERDE[i], livre ? HIGH : LOW);
  digitalWrite(VERMELHO[i], livre ? LOW : HIGH);
  if (HABILITAR_SERVOS) motores[i].write(livre ? ABERTO[i] : FECHADO[i]);
}

void medir(byte i) {
  digitalWrite(TRIG[i], LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG[i], HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG[i], LOW);
  unsigned long pulso = pulseIn(ECHO[i], HIGH, 25000UL);
  float cm = pulso / 58.0f;
  bool valido = pulso != 0 && cm >= 2 && cm <= 400;
  distancia[i] = valido ? cm : NAN;
  if (TESTE_SECO) {
    // Mede distancia real, mas nao inventa um nivel de agua sem calibracao.
    nivel[i] = NAN;
    controle[i].atualizar(cm, valido, DISTANCIA_FECHAR_CM, DISTANCIA_REABRIR_CM, true);
  } else {
    // Modo agua exige referencia e limites coerentes antes de liberar o trecho.
    bool configValida = CALIBRADO[i] && REABRIR_CM >= 0 && REABRIR_CM < BLOQUEAR_CM &&
                        BLOQUEAR_CM <= REFERENCIA[i] - 2.0f;
    bool nivelValido = valido && configValida && cm <= REFERENCIA[i] + 1.0f;
    nivel[i] = nivelValido ? fmaxf(0, REFERENCIA[i] - cm) : NAN;
    controle[i].atualizar(nivel[i], nivelValido, BLOQUEAR_CM, REABRIR_CM);
  }
  atuar(i);
}

void receber() {
  // Limita o trabalho por passagem para nao atrasar as leituras com entrada continua.
  byte budget = 32;
  while (budget-- && Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      if (!descartarEntrada && tamanhoEntrada) {
        entrada[tamanhoEntrada] = '\0';
        StaticJsonDocument<128> cmd;
        if (!deserializeJson(cmd, entrada) && cmd["tipo"] == "ping" &&
            cmd["id"].is<unsigned long>()) {
          Serial.print(F("{\"v\":1,\"tipo\":\"pong\",\"id\":"));
          Serial.print(cmd["id"].as<unsigned long>());
          Serial.println('}');
        }
      }
      tamanhoEntrada = 0;
      descartarEntrada = false;
    } else if (c != '\r' && !descartarEntrada) {
      if (tamanhoEntrada < sizeof(entrada) - 1) entrada[tamanhoEntrada++] = c;
      else descartarEntrada = true;
    }
  }
}

void publicar() {
  Serial.print(F("{\"v\":1,\"tipo\":\"estado\",\"seq\":"));
  Serial.print(++seq);
  Serial.print(F(",\"uptime_ms\":")); Serial.print(millis());
  Serial.print(F(",\"firmware\":\"estavel-20261125\",\"teste_seco\":"));
  Serial.print(TESTE_SECO ? F("true") : F("false"));
  Serial.print(F(",\"sensor_ambiente\":\""));
  Serial.print(TIPO_SENSOR_AMBIENTE == DHT11 ? F("DHT11") : F("DHT22"));
  Serial.print('"');
  Serial.print(F(",\"servos_habilitados\":"));
  Serial.print(HABILITAR_SERVOS ? F("true") : F("false"));
  Serial.print(F(",\"trechos\":{"));
  for (byte i = 0; i < 2; ++i) {
    if (i) Serial.print(',');
    Serial.print(i == 0 ? F("\"A\":{") : F("\"B\":{"));
    Serial.print(F("\"dist_cm\":")); numero(distancia[i]);
    Serial.print(F(",\"nivel_cm\":")); numero(nivel[i]);
    Serial.print(F(",\"estado\":\""));
    if (controle[i].estado == LIVRE) Serial.print(F("LIVRE"));
    else if (controle[i].estado == BLOQUEADO) Serial.print(F("BLOQUEADO"));
    else Serial.print(F("SENSOR_INDISPONIVEL"));
    Serial.print(F("\",\"cancela_comando\":\""));
    Serial.print(controle[i].estado == LIVRE ? F("ABRIR") : F("FECHAR"));
    Serial.print(F("\",\"calibrado\":"));
    Serial.print(!TESTE_SECO && CALIBRADO[i] ? F("true") : F("false"));
    Serial.print('}');
  }
  Serial.print(F("},\"ambiente\":{\"temp_c\":")); numero(temperatura);
  Serial.print(F(",\"umidade_pct\":")); numero(umidade);
  Serial.println(F("}}"));
}

void setup() {
  Serial.begin(115200);
  for (byte i = 0; i < 2; ++i) {
    pinMode(TRIG[i], OUTPUT); digitalWrite(TRIG[i], LOW);
    pinMode(ECHO[i], INPUT);
    pinMode(VERDE[i], OUTPUT); pinMode(VERMELHO[i], OUTPUT);
    if (HABILITAR_SERVOS) {
      motores[i].write(FECHADO[i]);
      motores[i].attach(SERVO_PIN[i]);
    }
    atuar(i);
  }
  ambiente.begin();
}

void medirAmbienteSemAlongarPulsoServo() {
  // A biblioteca DHT desabilita interrupcoes durante a leitura.
  // Suspender os pulsos evita alongar um pulso do Servo (Timer1).
  if (HABILITAR_SERVOS) {
    unsigned long inicio = micros();
    while ((digitalRead(SERVO_PIN[0]) || digitalRead(SERVO_PIN[1])) &&
           (unsigned long)(micros() - inicio) < 6000UL) {}
    for (byte i = 0; i < 2; ++i) {
      motores[i].detach();
      digitalWrite(SERVO_PIN[i], LOW);
    }
  }
  temperatura = ambiente.readTemperature();
  umidade = ambiente.readHumidity();
  if (HABILITAR_SERVOS) {
    for (byte i = 0; i < 2; ++i) {
      motores[i].attach(SERVO_PIN[i]);
      motores[i].write(controle[i].estado == LIVRE ? ABERTO[i] : FECHADO[i]);
    }
  }
}

void loop() {
  receber();
  unsigned long agora = millis();
  // 120ms entre quaisquer disparos; cada recipiente e lido a cada ~240ms.
  if (agora - ultimaMedida >= 120UL) {
    medir(proximoSensor);
    proximoSensor = 1 - proximoSensor;
    ultimaMedida = millis();
  }
  if (agora - ultimoAmbiente >= 2200UL) {
    medirAmbienteSemAlongarPulsoServo();
    if (!isfinite(temperatura) || temperatura < -40 || temperatura > 80) temperatura = NAN;
    if (!isfinite(umidade) || umidade < 0 || umidade > 100) umidade = NAN;
    ultimoAmbiente = millis();
  }
  if (agora - ultimoEnvio >= 1000UL) {
    publicar();
    ultimoEnvio = millis();
  }
}
