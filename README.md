# Calenday

Calendário e lista de demandas com notificação por push e por email.
Web app instalável (PWA), acessível de qualquer aparelho pelo navegador.

## Como funciona o modelo de dados

Existe **um tipo de registro só**, o `item`, com um campo `kind`:

- `event` — acontece num momento. Não se conclui, só passa.
- `task` — precisa ser feita. Tem estado de concluído.

Ambos aceitam título, intervalo de datas, horário opcional e um **conteúdo em
blocos** no estilo do Notion, onde texto, caixas de seleção, listas numeradas,
tópicos e imagens convivem na mesma ordem e podem ser reordenados arrastando.
As telas são duas leituras do mesmo conjunto: o **calendário** mostra tudo que
tem data, a **lista** mostra tudo com agrupamento por prazo. Marcar uma tarefa
como feita reflete nos dois lugares.

### Régua do dia

Ao selecionar um dia, os itens aparecem numa régua de horas: **horizontal no
desktop** e **vertical no mobile**. Itens que se sobrepõem no tempo são
distribuídos em faixas paralelas para não cobrirem uns aos outros. Um marcador
vermelho mostra o horário atual quando o dia selecionado é hoje, e a régua se
estende para sempre incluí-lo. Itens sem horário ficam numa faixa "dia inteiro"
acima da régua.

### Editor de blocos

No campo de conteúdo:

- `/` abre o menu de blocos (texto, lista de tarefas, numerada, tópicos, imagem).
- `1. ` no começo da linha vira lista numerada.
- `[] ` vira caixa de seleção (`[x] ` já marcada).
- `- ` vira tópico.
- `Enter` cria um bloco do mesmo tipo; `Enter` num item vazio volta a ser texto.
- `Backspace` num bloco vazio remove o bloco, ou desfaz o tipo de lista.
- O punho à esquerda (aparece ao passar o mouse) arrasta para reordenar.
- As imagens ficam **na posição em que foram inseridas**, entre os textos.

Os blocos são gravados como JSON na coluna `items.content`. As imagens viram
linhas em `attachments` para controle de disco: ao salvar, a imagem que saiu do
conteúdo é apagada do servidor automaticamente.

### Repetição, prioridade e insistência

- **Horário**: início opcional e fim opcional. O fim não muda o aviso (que sai
  sempre no início), ele define o tamanho do bloco na régua do dia. Sem hora de
  fim, o bloco ocupa 1 hora.
- **Repetição**: nunca, todo dia, de segunda a sexta, semanal ou mensal.
  Um item que se repete não tem data de fim: ele segue indefinidamente a
  partir da data de início. Mensal no dia 31 cai no último dia dos meses curtos.
- **Prioridade**: baixa, normal ou alta. A alta ganha um marcador no card,
  sobe na ordenação do dia e entra com `[!]` no título do aviso.
- **Insistir até o check**: reenvia o aviso a cada 30 minutos
  (`NAG_EVERY_MIN` no `.env`) enquanto a ocorrência do dia não for concluída.
  O push usa `requireInteraction`, então fica na tela até você tocar.

Conclusão é **por ocorrência**, não por item: marcar o lembrete de hoje não
marca o de amanhã. Isso fica na tabela `completions` (item + data).

Regras de notificação:
- Todo item avisa por push **e** por email, sempre os dois.
- Com horário: avisa naquele horário, em cada ocorrência.
- Sem horário: vira "dia inteiro" e avisa às 8h da manhã (ajustável no `.env`).
- O email sai só no primeiro aviso do dia; a insistência é só por push,
  para não encher a caixa de entrada.

---

## Instalação no servidor

Requisitos: Linux, Node.js 18+, domínio com HTTPS.
O push **não funciona** em http:// nem em IP puro, o HTTPS é obrigatório.

### 1. Node.js (se ainda não tiver)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
```

### 2. Subir os arquivos

```bash
sudo mkdir -p /var/www/calenday
# envie o conteúdo do projeto para essa pasta (scp, git, rsync...)
cd /var/www/calenday
npm install --omit=dev
```

### 3. Configurar o `.env`

```bash
cp .env.example .env
node scripts/generate-vapid.js   # copie as duas linhas geradas para o .env
nano .env
```

Preencha:

- `JWT_SECRET` — string aleatória longa. Gere com:
  `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` — saída do comando acima.
- `VAPID_SUBJECT` — `mailto:` com seu email.
- Bloco `SMTP_*` — necessário para o aviso por email.
  Com Gmail: host `smtp.gmail.com`, porta `587`, `SMTP_SECURE=false`,
  usuário é o email completo, e a senha é uma **senha de app** gerada em
  myaccount.google.com > Segurança (a senha normal da conta não funciona).

### 4. Rodar como serviço

```bash
sudo nano /etc/systemd/system/calenday.service
```

```ini
[Unit]
Description=Calenday
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/calenday
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo chown -R www-data:www-data /var/www/calenday
sudo systemctl enable --now calenday
sudo systemctl status calenday
```

### 5. Nginx como proxy

```nginx
server {
    listen 443 ssl http2;
    server_name calenday.seudominio.com;

    ssl_certificate     /etc/letsencrypt/live/calenday.seudominio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/calenday.seudominio.com/privkey.pem;

    client_max_body_size 10M;   # necessário para o upload de fotos

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name calenday.seudominio.com;
    return 301 https://$host$request_uri;
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Certificado, se ainda não tiver:
`sudo certbot --nginx -d calenday.seudominio.com`

### 6. Usar no celular

1. Abra o site no **Safari** (iPhone) ou Chrome (Android).
2. Crie sua conta. O email informado é o que recebe os avisos.
3. iPhone: Compartilhar > **Adicionar à Tela de Início**.
   Esse passo é obrigatório no iOS: o push só funciona com o app
   adicionado à tela de início, não funciona na aba normal do Safari.
4. Abra pelo ícone e toque em **Ativar** no aviso de notificações.

---

## Estrutura

```
server.js              servidor Express
db/database.js         schema SQLite (users, items, attachments, push_subscriptions)
routes/auth.js         cadastro, login, sessão
routes/items.js        CRUD de itens e anexos
routes/push.js         inscrição de push
services/notifier.js   verifica a cada minuto e dispara push + email
public/                front-end (PWA)
public/editor.js       editor de blocos estilo Notion
public/recurrence.js   regras de repetição (usado no servidor e no navegador)
uploads/               fotos anexadas
```

## Manutenção

- Logs: `sudo journalctl -u calenday -f`
- Backup: copie `db/app.db` e a pasta `uploads/`.
  O banco usa modo WAL, então copie também `app.db-wal` se existir,
  ou pare o serviço antes de copiar.
- Reiniciar: `sudo systemctl restart calenday`
