# Door counter

A small device at each canteen entrance counts people going in and out and reports the number inside about once a minute. CampusBite turns that into the crowd meter (people ÷ seats: under 40% Quiet, under 75% Moderate, otherwise Busy). If a counter stops reporting for 5 minutes, the app falls back to the kitchen queue, so nothing breaks.

## Parts (roughly ₹1,000–2,000 per door)

* ESP32 dev board (Wi-Fi)
* 2 × IR break-beam sensor pairs (or a VL53L1X time-of-flight sensor), mounted about 10 cm apart across the doorway at waist height. Two beams tell direction: A then B is someone entering, B then A is someone leaving.
* 5 V USB power supply

No camera, and nothing identifies a person: only a head-count leaves the device.

## Register the device

Admin → **Door counters** → **Add device**. Copy the key shown (it is displayed once).

## API

```
POST /api/sensors/occupancy
X-Device-Key: cbdev_...
Content-Type: application/json

{"people": 42}
```

Limits: 30 requests per minute per IP. A count above 5000 is rejected.

## Firmware sketch (Arduino / ESP32)

```cpp
#include <WiFi.h>
#include <HTTPClient.h>

const char* WIFI_SSID = "CampusIoT";
const char* WIFI_PASS = "...";
const char* URL = "https://bite.example.edu/api/sensors/occupancy";
const char* KEY = "cbdev_...";          // from Admin → Door counters

const int BEAM_A = 32, BEAM_B = 33;     // LOW when the beam is broken
volatile int inside = 0;
unsigned long aAt = 0, bAt = 0, lastPost = 0;

void setup() {
  pinMode(BEAM_A, INPUT_PULLUP);
  pinMode(BEAM_B, INPUT_PULLUP);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
}

void loop() {
  unsigned long now = millis();
  if (digitalRead(BEAM_A) == LOW && aAt == 0) aAt = now;
  if (digitalRead(BEAM_B) == LOW && bAt == 0) bAt = now;
  if (aAt && bAt) {                       // both beams crossed: decide direction
    if (aAt < bAt) inside++; else if (inside > 0) inside--;
    aAt = bAt = 0;
    delay(300);                           // let the person clear the doorway
  }
  if ((aAt && now - aAt > 1500) || (bAt && now - bAt > 1500)) aAt = bAt = 0;  // half-crossings

  if (now - lastPost > 60000 && WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(URL);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-Device-Key", KEY);
    http.POST("{\"people\":" + String(inside) + "}");
    http.end();
    lastPost = now;
  }
}
```

Reset `inside` to 0 at closing time (for example, when the server reports the canteen closed, or with a nightly timer), because counts drift over a day.
