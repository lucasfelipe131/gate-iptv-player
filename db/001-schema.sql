-- Esquema inicial do GATE TV.
--
-- Ainda NÃO está ligado ao servidor: hoje sessões, pareamentos e tickets vivem
-- em memória e somem a cada deploy. Este arquivo é o destino do F-08 e existe
-- para ser revisado antes de virar código.
--
-- Aplicar com:  psql "$DATABASE_URL" -f db/001-schema.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- Inquilino: cada cliente do produto white-label. A instalação atual é uma
-- única linha; a coluna existe desde já para não migrar dados depois.
CREATE TABLE IF NOT EXISTS tenants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,
  display_name  text NOT NULL,
  branding      jsonb NOT NULL DEFAULT '{}'::jsonb,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Assinante. E-mail é opcional porque o acesso na TV começa por código.
CREATE TABLE IF NOT EXISTS subscribers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email       citext,
  name        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

-- Licença: o que a cobrança ativa e a renovação estende. status e expires_at
-- juntos decidem se o player libera a reprodução.
CREATE TABLE IF NOT EXISTS licenses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subscriber_id  uuid NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  plan           text NOT NULL,
  status         text NOT NULL CHECK (status IN ('trial', 'active', 'past_due', 'canceled', 'expired')),
  max_devices    smallint NOT NULL DEFAULT 2 CHECK (max_devices > 0),
  started_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS licenses_renovacao_idx ON licenses (status, expires_at);
CREATE INDEX IF NOT EXISTS licenses_assinante_idx ON licenses (subscriber_id);

-- Pagamento. provider_event_id com UNIQUE é o que torna o webhook idempotente:
-- o provedor reenvia o mesmo evento e a segunda gravação é recusada pelo banco,
-- não pela aplicação.
CREATE TABLE IF NOT EXISTS payments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id         uuid NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  provider           text NOT NULL,
  provider_event_id  text NOT NULL,
  amount_cents       integer NOT NULL CHECK (amount_cents >= 0),
  currency           char(3) NOT NULL DEFAULT 'BRL',
  status             text NOT NULL CHECK (status IN ('pending', 'paid', 'refunded', 'failed')),
  paid_at            timestamptz,
  raw_payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)
);

-- Dispositivo pareado. O teto de telas do plano é contado aqui.
CREATE TABLE IF NOT EXISTS devices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id     uuid NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  platform       text NOT NULL,
  label          text,
  token_hash     bytea NOT NULL UNIQUE,
  last_seen_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS devices_licenca_idx ON devices (license_id);

-- Pareamento por QR. Substitui o Map em memória, cuja chave de cifragem era
-- sorteada a cada inicialização — o que tornava ilegível, após um restart,
-- qualquer descritor gravado antes dele.
CREATE TABLE IF NOT EXISTS pairing_sessions (
  code             text PRIMARY KEY,
  tenant_id        uuid REFERENCES tenants(id) ON DELETE CASCADE,
  status           text NOT NULL CHECK (status IN ('pending', 'ready', 'consumed', 'expired')),
  descriptor_type  text,
  ciphertext       bytea,
  iv               bytea,
  auth_tag         bytea,
  device_token_hash bytea,
  submitted_at     timestamptz,
  consumed_at      timestamptz,
  expires_at       timestamptz NOT NULL,
  purge_at         timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pairing_expurgo_idx ON pairing_sessions (purge_at);

COMMIT;

-- Rotina de limpeza (agendar como cron da Railway, uma vez por hora):
--   DELETE FROM pairing_sessions WHERE purge_at <= now();
