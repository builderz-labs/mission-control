# Cítara Builderz Parity

Este documento registra a decisão de manter o `builderz-labs/mission-control` como base do cockpit e adaptar tudo que for útil para o Mission Control Cítara/Hermes.

Referência completa no Cítara Brain:

- `/Users/phfer/hermes-workspaces/citara-tech-brain/docs/mission-control-builderz-feature-parity-2026-05-26.md`

## Prioridade P0

- Agentes + heartbeat + API keys por agente.
- Task board + fila segura `awaiting_owner` para Hermes Adapter.
- CLI + MCP server.
- Sessões/transcripts/continue para Hermes.
- Segurança: RBAC, CSRF, CSP, scan, secret scanner, injection guard, exec approvals.
- Activity/logs/eventos/custos.

## Prioridade P1

- Memory browser/knowledge graph.
- Skills Hub + scanner.
- Cron/scheduler/painel de recorrência.
- Webhooks + alerts.

## Prioridade P2

- Multi-gateway como arquitetura, não acoplamento a OpenClaw.
- Terminal/PTTY somente com hardening.
- Multi-tenant/provisioning depois do core Cítara estável.

## Regras Cítara

- Hermes é o runtime/motor.
- Mission Control é o cockpit.
- Hermes Adapter/Fleet Runner é a ponte.
- Tasks Hermes-owned entram por `awaiting_owner`, não `assigned`.
- Sucesso do Adapter vai para `quality_review`.
- Falha vai para `failed`.
- Langfuse entra depois.
- n8n entra depois como automação linear.

## Gaps imediatos

- Registrar rotas Cítara/Hermes em OpenAPI/API index.
- Adicionar testes para `/api/citara/*` e `/api/hermes/fleet-runner`.
- Parametrizar paths absolutos do Fleet Runner.
- Criar painel dedicado `Cítara Command Center`.
- Versionar adapter sem segredos, logs ou runtime.
