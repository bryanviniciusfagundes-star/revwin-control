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
  lib/csv.ts           ← leitura dos CSVs (números, datas, moedas, mapeamento)
  lib/recon.ts         ← regras da conferência IA × casa
  pages/               ← Dashboard, Operações, Registrar Resultados, Importar, Login
supabase/migrations/   ← SQL de cada etapa
```

## Regras já garantidas pelo banco
- Período sobreposto para a mesma operação + casa é bloqueado.
- Operação ou casa com resultados vinculados não pode ser excluída (use status "Encerrada").
- Campos não informados ficam vazios (NULL) e aparecem como "—"; nunca viram zero.
- Nomes de operações e casas não se repetem (ignorando maiúsculas/minúsculas).
- Cada linha só é acessível pelo usuário logado (RLS).

## Importação de CSV (Etapa 2)
- Uma importação por fonte (IA ou casa) em cada período; para trocar o arquivo, marque "substituir".
- O mesmo arquivo (mesmo conteúdo) não pode ser importado duas vezes.
- O arquivo original e as linhas de cada jogador ficam guardados no banco.
- FTD = jogador com depósito maior que zero. A soma de depósitos vem do arquivo da casa e fica vazia se faltar taxa de conversão.
- O mapeamento de colunas é reaplicado na próxima importação da mesma casa.

## Conferência (Etapa 3)
- FTD = todo jogador com depósito > 0, independente de status.
- IDs que não se encontram não são tratados como jogadores diferentes: aparecem como "Só na IA", "Só na casa" ou "Casa não mostra depósito".
- Baseline e QFTD usam os dados da casa: soma dos depósitos ≥ baseline da operação e apostas conforme a regra da casa (> ou ≥ um valor em USD).
- Valores só são comparados quando equivalentes: 1º depósito × 1º depósito, ou total com 1 único depósito. Sem conversão confiável, o par fica "Não comparável".
- A taxa implícita da casa (mediana dos jogadores com 1 depósito) aparece como sugestão e pode ser aplicada com "Usar".
- Tolerância de divergência em Configurações (padrão US$ 1,00).
- Uma conferência salva por casa e período; se um CSV for trocado, ela aparece como desatualizada.
