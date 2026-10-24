// Static trust pages (About, Editorial policy, Privacy) in English and Spanish.
// Rendered by the SPA and server-side for crawlers. Statements here must stay true to how
// the site actually works; update them whenever sources, AI use or advertising change.
import { CONTACT_URL } from './seo.js';

export const STATIC_PAGES = {
  '/about': {
    en: [
      ['', [
        'Noticiero VOID is an independent, bilingual (English and Spanish) financial news and market-data site. It brings together headlines from more than 30 financial publishers and official sources, adds original market context, and links every story to the publisher that reported it.',
        'Noticiero VOID is run as a small automated newsroom: software collects feeds and market data, and an AI writer produces short original reports from published facts under the rules in our editorial policy. We do not employ reporters and we do not claim original reporting we have not done.',
      ]],
      ['Where our data comes from', [
        'News: publisher RSS/Atom feeds (headline, a short excerpt and a link). Official releases from the Federal Reserve, BEA, ECB and Bank of England are shown in full because their terms allow it.',
        'Market and economic data: FRED (St. Louis Fed), U.S. Treasury FiscalData, CoinGecko, DefiLlama, GeckoTerminal, OKX, Blockscout explorers and Solana RPC. Every data widget shows its source, status and last update.',
      ]],
      ['Contact', [`Questions, corrections and rights requests: open an issue at ${CONTACT_URL}`]],
    ],
    es: [
      ['', [
        'Noticiero VOID es un sitio independiente y bilingüe (inglés y español) de noticias financieras y datos de mercado. Reúne titulares de más de 30 medios financieros y fuentes oficiales, añade contexto de mercado propio y enlaza cada noticia con el medio que la publicó.',
        'Noticiero VOID funciona como una pequeña redacción automatizada: un software recoge feeds y datos de mercado, y una IA redacta informes breves y originales a partir de hechos publicados, con las reglas de nuestra política editorial. No tenemos reporteros y no atribuimos a nuestro trabajo una investigación propia que no hemos hecho.',
      ]],
      ['De dónde salen nuestros datos', [
        'Noticias: feeds RSS/Atom de los medios (titular, extracto breve y enlace). Los comunicados oficiales de la Reserva Federal, BEA, BCE y Banco de Inglaterra se muestran íntegros porque sus condiciones lo permiten.',
        'Datos económicos y de mercado: FRED (Fed de San Luis), U.S. Treasury FiscalData, CoinGecko, DefiLlama, GeckoTerminal, OKX, exploradores Blockscout y Solana RPC. Cada widget muestra su fuente, estado y última actualización.',
      ]],
      ['Contacto', [`Preguntas, correcciones y solicitudes de derechos: abre una incidencia en ${CONTACT_URL}`]],
    ],
  },
  '/editorial-policy': {
    en: [
      ['Sources and attribution', [
        'We publish a publisher’s headline, a short excerpt (240 characters at most), its feed image credited to the publisher, and a prominent link to the full story. We never reproduce the body of a commercial article.',
      ]],
      ['AI-written VOID Reports', [
        'Many story pages include a “VOID Report”: a short original story written by an AI model (Workers AI) using only the facts in the publisher’s headline and excerpt and in other outlets’ coverage of the same story. It is always labelled “Written with AI”.',
        'Automatic checks discard any paragraph that copies the sources’ wording, contains a quote the sources do not contain, or states a number the sources do not report. Reports can still contain errors, so each one links to the original source. Only story pages with a VOID Report are offered to search engines.',
      ], 'ai'],
      ['News, analysis and advertising', [
        'News reports state reported facts. Market scenarios and AI analysis are labelled as conditional analysis, never as predictions or investment advice. Advertising is supplied by Monetag and is never presented as editorial content.',
      ]],
      ['Corrections', [
        `If something we publish is wrong, open an issue at ${CONTACT_URL}. We review every request; when a VOID Report is inaccurate we correct or remove it, and when a publisher updates or withdraws a story we follow its current version.`,
      ], 'corrections'],
    ],
    es: [
      ['Fuentes y atribución', [
        'Publicamos el titular del medio, un extracto breve (240 caracteres como máximo), la imagen de su feed con crédito al medio y un enlace destacado a la noticia completa. Nunca reproducimos el cuerpo de un artículo comercial.',
      ]],
      ['Informes VOID redactados con IA', [
        'Muchas páginas de noticia incluyen un «Informe VOID»: una noticia breve y original escrita por un modelo de IA (Workers AI) usando solo los hechos del titular y extracto del medio y de la cobertura de otros medios sobre la misma noticia. Siempre lleva la etiqueta «Redactado con IA».',
        'Unos controles automáticos descartan cualquier párrafo que copie la redacción de las fuentes, incluya una cita que las fuentes no contienen o dé una cifra que las fuentes no publican. Aun así puede contener errores, por eso cada informe enlaza a la fuente original. Solo las páginas con Informe VOID se ofrecen a los buscadores.',
      ], 'ai'],
      ['Noticias, análisis y publicidad', [
        'Las noticias recogen hechos publicados. Los escenarios de mercado y el análisis con IA se etiquetan como análisis condicional, nunca como predicciones ni asesoramiento de inversión. La publicidad la sirve Monetag y nunca se presenta como contenido editorial.',
      ]],
      ['Correcciones', [
        `Si algo que publicamos es incorrecto, abre una incidencia en ${CONTACT_URL}. Revisamos cada solicitud; si un Informe VOID es inexacto lo corregimos o lo retiramos, y si un medio actualiza o retira una noticia seguimos su versión vigente.`,
      ], 'corrections'],
    ],
  },
  '/privacy': {
    en: [
      ['What this site stores in your browser', [
        'Your language choice and saved stories are kept in your browser’s local storage and never sent to us. If you use whale alerts, the browser keeps a random anonymous key; our server stores only its hash together with the public wallet addresses and alert rules you create.',
      ]],
      ['Hosting', ['The site runs on Cloudflare, which processes IP addresses and request data to deliver and protect the service. We do not run analytics or tracking scripts of our own.']],
      ['Advertising', [
        'Ads are served by Monetag, which may set cookies or similar identifiers and process your IP address and device data to deliver and measure ads. Push-notification ads appear only if you allow notifications in your browser; you can revoke that permission at any time in your browser settings. See Monetag’s privacy policy at https://monetag.com/privacy-policy/.',
      ]],
      ['Your choices and contact', [`You can clear this site’s data from your browser at any time. For privacy requests, open an issue at ${CONTACT_URL}.`]],
    ],
    es: [
      ['Qué guarda este sitio en tu navegador', [
        'Tu idioma y tus noticias guardadas se conservan en el almacenamiento local del navegador y nunca se nos envían. Si usas las alertas de ballenas, el navegador guarda una clave anónima aleatoria; nuestro servidor guarda solo su hash junto con las direcciones públicas y las reglas de alerta que crees.',
      ]],
      ['Alojamiento', ['El sitio funciona sobre Cloudflare, que procesa direcciones IP y datos de las peticiones para servir y proteger el servicio. No usamos scripts de analítica o seguimiento propios.']],
      ['Publicidad', [
        'Los anuncios los sirve Monetag, que puede usar cookies o identificadores similares y procesar tu IP y datos del dispositivo para mostrar y medir anuncios. Los anuncios por notificación push solo aparecen si permites las notificaciones en tu navegador; puedes retirar ese permiso cuando quieras en los ajustes. Consulta la política de privacidad de Monetag en https://monetag.com/privacy-policy/.',
      ]],
      ['Tus opciones y contacto', [`Puedes borrar los datos de este sitio desde tu navegador cuando quieras. Para solicitudes de privacidad, abre una incidencia en ${CONTACT_URL}.`]],
    ],
  },
};
