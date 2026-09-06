# El lanzador (Cloudflare)

Para que el botón «Actualizar» de la página funcione de verdad en vez de
mandarte a GitHub. Son diez minutos y se hace una sola vez.

El token que crees en el paso 1 **no me lo pegues por el chat**: va directo del
portapapeles al panel de Cloudflare. Yo no necesito verlo en ningún momento.

## 1. Un token de GitHub, del más limitado que hay

En GitHub: tu foto → **Settings** → abajo del todo **Developer settings** →
**Personal access tokens** → **Fine-grained tokens** → **Generate new token**.

- **Token name**: `lanzador de la liga`
- **Expiration**: un año (cuando caduque, esto deja de lanzar y se repite el paso)
- **Repository access**: *Only select repositories* → **cibernull/mister**
- **Permissions** → *Repository permissions* → busca **Actions** → **Read and write**

Nada más. Con eso solo puede lanzar el workflow de esta liga: no puede leer tu
código privado, ni tocar otros repositorios, ni entrar en tu cuenta.

Genéralo y **cópialo**. GitHub lo enseña una sola vez.

## 2. La cuenta de Cloudflare

`dash.cloudflare.com/sign-up` — gratis y sin tarjeta.

## 3. El programa

**Workers & Pages** → **Create** → **Workers** → **Create Worker**.

- Nómbralo `liga-de-mister` y dale a **Deploy** (crea uno de ejemplo).
- **Edit code**: borra todo lo que haya y pega el contenido de
  [`worker.js`](worker.js). **Deploy**.

## 4. El token, dentro

En el Worker: **Settings** → **Variables and Secrets** → **Add**.

- Type: **Secret**
- Name: `GITHUB_TOKEN`  ← exactamente así
- Value: el token del paso 1

**Deploy**. A partir de aquí el token queda cifrado: ni tú vuelves a verlo en
el panel.

## 5. El reloj

Mismo Settings → **Trigger Events** → **Cron Triggers** → **Add**, dos veces:

```
7,37 5-22 * * *
7 23,0-4 * * *
```

Esto es lo que hace que la liga se actualice sola de forma puntual. El cron de
GitHub Actions es «cuando pueda» y se salta slots; el de Cloudflare, no.

## 6. Dime la dirección

Arriba del Worker verás algo como
`https://liga-de-mister.LOALGO.workers.dev`. Esa dirección **sí** me la puedes
pegar: no es secreta. Con ella conecto el botón de la página y termino.
