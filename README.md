# Multi-model AI Orchestrator

OpenAI, Anthropic ve Gemini modellerini görev rolü ve capability bilgisine göre seçen; ortak proje klasöründe doğrudan dosya üreten, task DAG, dinamik worker yaşam döngüsü, retry, eşzamanlı worker ve maliyet limitleri içeren Node.js + TypeScript MVP.

API anahtarı olmadan resmi Codex ve Google Antigravity CLI oturumları kullanılabilir. Orkestra rol ve capability bilgisine göre etkin modeller arasında seçim yapar. Claude CLI kurulmuş olsa bile bağlantısı tamamlanmadığı sürece varsayılan olarak kapalı başlar; Web arayüzündeki **Modeller** sekmesinden daha sonra açılabilir. Bir CLI bulunamazsa o sağlayıcı havuza alınmaz; sistem uygun görevlerde yerleşik `mock` provider ile çalışmaya devam eder.

## Mimari

```text
CLI / HTTP → Zod validation → MasterOrchestrator → ModelRouter
                                      │               │
                                      │               └─ role + capability + availability
                                      ├─ DAG scheduler / budget / retry / worker lifecycle
                                      ├─ TaskQueue interface → InMemoryTaskQueue
                                      └─ Provider interface → OpenAI | Anthropic | Gemini | Mock
```

- **Dinamik worker:** Her runnable task için geçici bir worker (`AbortController` + Promise) oluşturulur; tamamlanınca veya sonlandırılınca kayıt silinir.
- **Adaptif routing:** Aday modeller rol, capability ve önceliğe göre sıralanır. Bir model çalışma anında hata verirse toplam retry sınırı içinde sıradaki uyumlu sağlayıcıya geçilir; açıkça seçilmiş provider/model tercihinin dışına çıkılmaz.
- **Hard limit:** Worker ve retry limitleri şema ile sınırlandırılır. Bir task başlamadan önce UTF-8 byte sayısı + maksimum output token üzerinden konservatif maliyet rezervasyonu yapılır; rezervasyon bütçeyi aşarsa çağrı yapılmaz.
- **DAG/state:** Eksik dependency, self-dependency, duplicate id ve cycle başlamadan reddedilir. Dependency başarısızsa alt task `blocked` olur.
- **Provider abstraction:** Sağlayıcı adaptörleri ortak `ModelProvider` interface'ini uygular. API anahtarları sadece environment üzerinden alınır.
- **Ortak workspace:** Planlama ve inceleme worker'ları proje dosyalarını okur; Codex üretim/final worker'ları seçili klasörde dosyaları doğrudan oluşturur, düzenler, silebilir ve doğrulama komutlarını çalıştırır. Codex `workspace-write` sandbox'ı dışındaki konumlara yazamaz.
- **Queue:** İlk sürümde in-memory. Kalıcı/dağıtık çalışma gerektiğinde `TaskQueue` arkasına BullMQ adaptörü eklenebilir.

## Kurulum

Gereksinim: Node.js 20.12+.

```bash
npm install
cp .env.example .env
npm run build
```

Kişisel hesaplarınız (ChatGPT, Claude Pro vb.) üzerinden API anahtarı olmadan kullanım yapabilmek için ilgili sağlayıcıların resmi CLI (komut satırı) araçlarını sisteminize küresel olarak kurmanız gereklidir. Örnek kurulumlar:

```bash
# OpenAI (ChatGPT) için
npm install -g @openai/codex

# Anthropic (Claude) için (kurulum yöntemi sisteminize göre değişebilir, örn: brew install claude)
# Gemini (Antigravity) için
npm install -g @antigravity/cli
```

Kurulumlardan sonra, terminaliniz üzerinden bir defaya mahsus resmi girişlerinizi tamamlayın:

```bash
codex login
claude auth login
agy login
```

Eğer Node.js sunucusu çalışırken bu araçları otomatik bulamazsa, `.env` dosyanıza bu araçların bilgisayarınızdaki tam yolunu belirtebilirsiniz (örneğin: `CODEX_CLI_PATH=/opt/homebrew/bin/codex`).

Bu proje giriş kodlarını veya OAuth belirteçlerini okumaz veya depolamaz; yalnızca resmi CLI süreçlerini kendi güvenli alanınızda çalıştırır. İstersen API sağlayıcılarını ayrıca tanımlayabilirsin:

```dotenv
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
```

Dosyalar varsayılan olarak `work/project` içinde oluşturulur. Arayüzde **Ayarlar → Proje klasörü → Gözat** ile macOS klasör seçicisi açılır; yol elle de girilebilir. Başlangıç değerini değiştirmek için `.env` içinde mutlak veya proje köküne göre bağıl yol tanımla:

```dotenv
PROJECT_WORKSPACE=/tam/yol/projem
```

Bu klasör worker'ların çalışma sınırıdır. Üretim ve final aşamaları burada doğrudan değişiklik yapabildiği için değerli bir proje üzerinde kullanmadan önce Git ile sürüm kontrolü önerilir.

## Demo ve CLI

Anahtarsız demo:

```bash
npm run dev -- demo
```

JSON dosyasından çalıştırma:

```bash
npm run dev -- run examples/request.json
```

Bir task belirli sağlayıcı/modeli zorlayabilir:

```json
{
  "id": "review",
  "role": "review",
  "capability": "analysis",
  "prompt": "Review this design",
  "preferredProvider": "anthropic",
  "preferredModel": "claude-sonnet-4-6"
}
```

Anahtar yoksa bu explicit tercih anlaşılır bir `No model available` task hatası üretir; başka sağlayıcıya sessizce düşmez.

## Web arayüzü

```bash
npm run dev -- serve
```

Ardından tarayıcıda `http://127.0.0.1:3000` adresini aç. Sağ üstteki anahtar iki çalışma biçimi sunar:

- **Orkestra:** Prompt planlama, araştırma, üretim, denetim ve final görevlerine ayrılır; modeller rol bazında paslaşır.
- **Agent:** Her mesaj doğrudan aynı GPT ajanına gider. Sohbetin son 20 mesajı bağlam olarak korunur; “projeyi çalıştır”, “hatayı düzelt” gibi devam komutları yeni bir orkestra döngüsü başlatmaz.

Worker'lar yalnızca cevap metni üretmek yerine seçili proje klasörünü inceler ve gerektiğinde dosyaları doğrudan değiştirir. GPT normal kodlama araçlarını ve terminali kullanabilir, ancak kalıcı proje dosyalarına yazma yetkisi seçili workspace ile sınırlıdır. Her adımın durumu ve seçilen model ailesi canlı görünür.

Sağdaki **Sohbetler** alanı en fazla 30 oturumu tarayıcıda yerel olarak saklar. Her oturum son 50 mesajını, Agent/Orkestra seçimini ve proje klasörünü hatırlar; bir sohbete dönüldüğünde ilgili workspace otomatik etkinleştirilir. Satırdaki `×` düğmesi yalnızca sohbet kaydını siler, proje dosyalarını silmez. Sunucuya veya buluta ayrı bir sohbet veritabanı gönderilmez.

Bir cevap üretilirken gönder düğmesi kare **Durdur** düğmesine dönüşür. Durdurmak hem tarayıcı akışını hem de çalışan CLI worker'ını iptal eder; model arka planda dosya işlemlerine devam etmez.

Üstteki **Modeller** sekmesi ChatGPT, Claude ve Gemini'nin gerçek kullanılabilirlik durumunu gösterir. Aç/kapat değişiklikleri bellekte tutulur ve yeni başlayan aşamalarda uygulanır; sunucu yeniden başlatıldığında varsayılanlar geri gelir. Bağlantısı henüz tamamlanmamış Claude CLI varsayılan olarak kapalıdır.

## HTTP API

```bash
npm run dev -- serve
curl http://localhost:3000/health
curl -X POST http://localhost:3000/runs \
  -H 'content-type: application/json' \
  --data @examples/request.json
```

Endpoint'ler:

- `GET /health`
- `GET /providers` — CLI/model kullanılabilirlik ve etkinlik durumlarını döndürür.
- `POST /providers/:provider` — `{"enabled": true|false}` ile sağlayıcıyı çalışma anında açar veya kapatır.
- `GET /workspace` — etkin proje klasörünü döndürür.
- `POST /workspace` — var olan bir proje klasörünü doğrulayıp etkin workspace yapar; disk kökü ve kullanıcı ana klasörü reddedilir.
- `POST /cancel` — çalışan tüm model worker'larını iptal eder.
- `POST /runs` — Zod ile doğrulanan run isteğini senkron yürütür ve sonucu döndürür.
- `POST /project-runs/stream` — GUI için NDJSON biçiminde canlı task durumları ve final sonucu döndürür.
- `POST /agent-runs/stream` — konuşma bağlamıyla tek GPT ajan görevini canlı yürütür.

HTTP gövdesi 1 MB ile sınırlıdır. Doğrudan API istekleri varsayılan 180 saniye timeout kullanır. Üyelikle çalışan Codex, Claude ve Antigravity CLI oturumlarında varsayılan süre sınırı yoktur; süreç kendi sonucu/hatası gelene veya worker iptal edilene kadar açık kalır. İstenirse `SUBSCRIPTION_TIMEOUT_MS` ile sınır konabilir. TLS doğrulaması kapatılmaz ve hata yanıtlarında anahtar/provider body içeriği loglanmaz.

## İstek formatı

```json
{
  "goal": "Overall goal",
  "limits": {
    "maxWorkers": 3,
    "maxRetries": 2,
    "maxBudgetUsd": 1
  },
  "tasks": [
    {
      "id": "plan",
      "role": "architecture",
      "capability": "reasoning",
      "prompt": "Create the plan",
      "dependencies": [],
      "maxOutputTokens": 1000
    }
  ]
}
```

`tasks` verilmezse goal için tek bir `general/reasoning` task oluşturulur.

## PostgreSQL ve Redis/BullMQ

Temel PostgreSQL şeması [db/migrations/001_initial.sql](db/migrations/001_initial.sql) dosyasındadır. MVP onu otomatik çalıştırmaz; state varsayılan olarak bellektedir.

BullMQ eklemek için `TaskQueue.submit` interface'ini uygulayan bir adaptör yazılır. Üretimde ayrıca task payload/result serialization, idempotency ve worker heartbeat gerekir; bunlar in-memory MVP'ye gereksiz bağımlılık ve operasyon yükü eklememek için dahil edilmedi.

## Doğrulama

```bash
npm run typecheck
npm test
npm run test:coverage
npm run build
```

Not: Model adları ve fiyatlar `src/config.ts` içindeki registry verisidir; 4 Ekim 2026 tarihinde resmi [OpenAI model](https://platform.openai.com/docs/models), [Anthropic model/pricing](https://docs.anthropic.com/en/docs/about-claude/models) ve [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) sayfalarına göre ayarlanmıştır. Sağlayıcı değişikliklerinde registry güncellenmelidir. Gerçek maliyet provider usage metadata'sından hesaplanır; çağrı öncesi hard gate ise maksimum output ve konservatif input rezervasyonu kullanır.
