# Tap-Tap Tips

Plataforma web de propinas digitales: el cliente toca una tarjeta NFC o escanea un QR, elige cantidad y paga. Sin app, sin efectivo.

## Arrancar

```bash
npm install
npm start          # http://localhost:3000  (modo demo, sin cargos reales)
```

Prueba la página de propinas de ejemplo en `/t/demo`.

## Funcionalidades

- **Página personal** `/t/<enlace>` optimizada para móvil: importes rápidos (2/5/10 € u otra), valoración ★, mensaje y nombre.
- **El cliente puede cubrir la comisión** de pago para que llegue el 100 % de la propina.
- **QR descargable, tarjeta imprimible y grabación NFC** desde el navegador (Web NFC en Chrome Android).
- **Panel**: saldo, hoy / 7 días, valoración media, objetivo mensual, últimas propinas con mensajes.
- **Locales y bote común**: crea un local, el equipo se une con un código, los clientes eligen persona o bote en `/v/<local>`, el responsable reparte a partes iguales.
- **Retiradas** a IBAN (mínimo 5 €) con libro de movimientos contable.
- PWA instalable, modo oscuro, protección CSRF, contraseñas con scrypt.

## Configuración (variables de entorno)

| Variable | Descripción | Por defecto |
|---|---|---|
| `PORT` | Puerto | `3000` |
| `BASE_URL` | URL pública (la que va en QR/NFC) | `http://localhost:PORT` |
| `STRIPE_SECRET_KEY` | Activa pagos reales con Stripe Checkout (Apple Pay, Google Pay, tarjeta) | vacío = modo demo |
| `STRIPE_WEBHOOK_SECRET` | Webhook `POST /webhooks/stripe` (`checkout.session.completed`) | — |
| `FEE_PCT` / `FEE_FIXED_CENTS` | Comisión de pago estimada | `1.5` / `25` |
| `DB_PATH` | Archivo SQLite | `./taptap.db` |

Requiere Node 22.5+ (usa `node:sqlite` integrado).

## Pendiente para producción

- Pagos a los trabajadores: hoy las retiradas quedan "solicitadas"; para automatizarlas, usar Stripe Connect (cuentas Express) y transferir a cada persona.
- KYC / verificación de identidad (lo exige Stripe Connect), recuperación de contraseña por email, panel de administración.
