# Tracking pixel snippets (Partytown-wrapped)

Reference snippets for `/anglesite:tracking`. Drop these into `src/components/TrackingPixels.astro` — one block per platform — and the layout component will only render the ones whose `TRACKING_*` key is set in `.site-config`.

Each snippet uses `is:inline` so Astro doesn't bundle the script and the `data-partytown-type="text/partytown"` attribute so the consent runtime knows which type to restore when promoting a `text/plain` script after consent.

Variables referenced below come from the component frontmatter:

```ts
const adsType       = consentEnabled ? "text/plain" : "text/partytown";
const analyticsType = consentEnabled ? "text/plain" : "text/partytown";
```

## Meta Pixel

```astro
{metaPixelId && (
  <script type={adsType} data-consent="ads" data-partytown-type="text/partytown" is:inline set:html={`
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
    document,'script','https://connect.facebook.net/en_US/fbevents.js');
    fbq('init','${metaPixelId}');fbq('track','PageView');
  `} />
)}
```

## Google Ads / GA4 (shared `gtag.js` loader)

```astro
{gtagId && (
  <>
    <script type={ga4Id ? analyticsType : adsType} data-consent={ga4Id ? "analytics" : "ads"} data-partytown-type="text/partytown" is:inline async src={`https://www.googletagmanager.com/gtag/js?id=${gtagId}`} />
    <script type={ga4Id ? analyticsType : adsType} data-consent={ga4Id ? "analytics" : "ads"} data-partytown-type="text/partytown" is:inline set:html={`
      window.dataLayer=window.dataLayer||[];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      ${ga4Id       ? `gtag('config', '${ga4Id}');`       : ""}
      ${googleAdsId ? `gtag('config', '${googleAdsId}');` : ""}
    `} />
  </>
)}
```

`gtagId` is `ga4Id ?? googleAdsId` — the loader is the same script, so emit it once even when both keys are set.

## LinkedIn Insight Tag

```astro
{linkedinId && (
  <script type={adsType} data-consent="ads" data-partytown-type="text/partytown" is:inline set:html={`
    _linkedin_partner_id="${linkedinId}";window._linkedin_data_partner_ids=window._linkedin_data_partner_ids||[];
    window._linkedin_data_partner_ids.push(_linkedin_partner_id);
    (function(l){if(!l){window.lintrk=function(a,b){window.lintrk.q.push([a,b])};window.lintrk.q=[]}
    var s=document.getElementsByTagName("script")[0];var b=document.createElement("script");
    b.type="text/javascript";b.async=true;b.src="https://snap.licdn.com/li.lms-analytics/insight.min.js";
    s.parentNode.insertBefore(b,s);})(window.lintrk);
  `} />
)}
```

## TikTok Pixel

```astro
{tiktokId && (
  <script type={adsType} data-consent="ads" data-partytown-type="text/partytown" is:inline set:html={`
    !function (w, d, t) { w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];
    ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];
    ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};
    for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);
    ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};
    ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";
    ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};
    var o=document.createElement("script");o.type="text/javascript";o.async=!0;o.src=i+"?sdkid="+e+"&lib="+t;
    var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};
    ttq.load('${tiktokId}'); ttq.page(); }(window, document, 'ttq');
  `} />
)}
```

## Pinterest Tag

```astro
{pinterestId && (
  <script type={adsType} data-consent="ads" data-partytown-type="text/partytown" is:inline set:html={`
    !function(e){if(!window.pintrk){window.pintrk=function(){window.pintrk.queue.push(Array.prototype.slice.call(arguments))};
    var n=window.pintrk;n.queue=[],n.version="3.0";var t=document.createElement("script");t.async=!0,t.src=e;
    var r=document.getElementsByTagName("script")[0];r.parentNode.insertBefore(t,r)}}("https://s.pinimg.com/ct/core.js");
    pintrk('load','${pinterestId}');pintrk('page');
  `} />
)}
```

## X / Twitter Pixel

```astro
{xId && (
  <script type={adsType} data-consent="ads" data-partytown-type="text/partytown" is:inline set:html={`
    !function(e,t,n,s,u,a){e.twq||(s=e.twq=function(){s.exe?s.exe.apply(s,arguments):s.queue.push(arguments)},
    s.version='1.1',s.queue=[],u=t.createElement(n),u.async=!0,u.src='https://static.ads-twitter.com/uwt.js',
    a=t.getElementsByTagName(n)[0],a.parentNode.insertBefore(u,a))}(window,document,'script');
    twq('config','${xId}');
  `} />
)}
```
