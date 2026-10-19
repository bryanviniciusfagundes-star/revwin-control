# Revwin Control

Plataforma privada de controle das operações de iGaming.
React + TypeScript + Tailwind + Supabase. Publicação automática no GitHub Pages.

## Configuração (uma vez só)

### 1. Supabase
Tudo pronto: projeto **Revwin Control** criado, tabelas aplicadas, `src/config.ts` preenchido, usuário de login criado e cadastro de novas contas bloqueado no banco (`002_bloquear_cadastro_publico.sql`).

### 2. Código
Nada a fazer. Se um dia trocar de projeto Supabase, edite as duas linhas de `src/config.ts`.

### 3. GitHub Pages
1. Crie um repositório e envie todos os arquivos desta pasta (pode ser pelo upload do próprio site do GitHub; não envie `node_modules` nem `dist`).
2. No repositório: **Settings → Pages → Source: GitHub Actions**.
3. Cada alteração na branch `main` recompila e publica sozinha (aba **Actions** mostra o andamento).

## Estrutura

```
src/
  config.ts            ← URL e chave do Supabase
  lib/metrics.ts       ← regras das porcentagens (edite aqui para mudar a base de cálculo)
  lib/data.ts          ← todas as leituras/gravações no banco
  pages/               ← Dashboard, Operações, Registrar Resultados, Login
supabase/migrations/   ← SQL de cada etapa
```

## Regras já garantidas pelo banco
- Período sobreposto para a mesma operação + casa é bloqueado.
- Operação ou casa com resultados vinculados não pode ser excluída (use status "Encerrada").
- Campos não informados ficam vazios (NULL) e aparecem como "—"; nunca viram zero.
- Nomes de operações e casas não se repetem (ignorando maiúsculas/minúsculas).
- Cada linha só é acessível pelo usuário logado (RLS).
