# Site e painéis (MVP)

| Caminho | Quem usa |
|---|---|
| `/` | Site do produto |
| `/cliente/` | Painel do restaurante (só o e-mail Google cadastrado pela plataforma) |
| `/plataforma/` | Painel do administrador: cadastra restaurantes e donos, suspende e dá suporte |

## Trocar nome, logo, cor e contatos

Edite **só** `assets/marca.js`. Para a logo, coloque o arquivo em `assets/` (ex.: `assets/logo.svg`) e escreva o nome do arquivo no campo `logo`.
Se a logo for escura, coloque uma versão clara em `logoClara` (usada nos fundos azul-escuros).

## Arquivos compartilhados

- `assets/base.css`: cores, letras, botões, campos, diálogos
- `assets/painel.css`: estrutura dos painéis (barra lateral, abas no celular, senhas)
- `assets/ui.js`: avisos, confirmações e ícones
- `assets/icones.svg`: ícones

Dados no Firebase (projeto `pdvmovel-95afb`). Regras de segurança em `firebase.rules.json`.
