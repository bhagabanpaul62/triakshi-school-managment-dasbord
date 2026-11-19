/**
 * The public site's stylesheet. Plain CSS on purpose: the app's Tailwind build does not scan this package,
 * and the public site must not depend on the dark kit. Colours come only from the --site-* variables (siteCss).
 * Each design (data-template) sets a few --st-* knobs first, then its own layout rules.
 */
export const SITE_CSS = `
.st-root{background:var(--site-background);color:var(--site-text);font-family:var(--st-body);line-height:1.6;min-height:100dvh;display:flex;flex-direction:column;-webkit-font-smoothing:antialiased;
--st-r:calc(var(--site-radius) + 4px);--st-pad:72px;--st-line:color-mix(in srgb,var(--site-text) 12%,transparent);
--st-deep:color-mix(in srgb,var(--site-primary) 80%,#000);--st-dark:color-mix(in srgb,var(--site-text) 90%,var(--site-primary));--st-shadow:0 0 0 1px var(--st-line)}
.st-root *,.st-root *::before,.st-root *::after{box-sizing:border-box}
.st-root h1,.st-root h2,.st-root h3{font-family:var(--st-head);line-height:1.2;margin:0;letter-spacing:-0.01em}
.st-root p{margin:0}
.st-root a{color:inherit}
.st-root img{max-width:100%}
.st-wrap{width:100%;max-width:1160px;margin:0 auto;padding:0 20px}
.st-main{flex:1}
.st-skip{position:absolute;left:-9999px}
.st-skip:focus{left:12px;top:12px;z-index:50;background:var(--site-background);padding:10px 16px;border-radius:8px}
.st-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:46px;padding:0 24px;border-radius:calc(var(--site-radius) + 6px);background:var(--site-primary);color:#fff;font-weight:600;font-size:15px;text-decoration:none;border:0;cursor:pointer;font-family:inherit}
.st-btn:hover{filter:brightness(.92)}
.st-root a:focus-visible,.st-btn:focus-visible,.st-input:focus-visible,.st-root summary:focus-visible{outline:3px solid var(--site-accent);outline-offset:2px}
.st-btn[disabled]{opacity:.6;cursor:progress}
.st-btn.st-ghost{background:transparent;color:var(--site-primary);box-shadow:inset 0 0 0 2px var(--site-primary)}
.st-actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:28px}

/* top strip and header */
.st-topbar{display:none;font-size:13px}
.st-topbar .st-wrap{display:flex;gap:20px;justify-content:space-between;align-items:center;min-height:38px;flex-wrap:wrap}
.st-topbar span{display:flex;gap:20px}
.st-topbar a{text-decoration:none}
.st-topbar a:hover{text-decoration:underline}
.st-header{background:var(--site-background);position:sticky;top:0;z-index:20}
.st-header .st-wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:72px;padding-top:8px;padding-bottom:8px}
.st-brand{display:flex;align-items:center;gap:12px;text-decoration:none;font-family:var(--st-head);font-weight:700;font-size:19px;color:var(--site-text);min-width:0}
.st-brand span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.st-brand img{height:46px;width:auto;border-radius:6px}
.st-nav{display:flex;gap:4px;align-items:center}
.st-nav a{padding:9px 14px;border-radius:calc(var(--site-radius) + 4px);text-decoration:none;font-weight:500;font-size:15px;color:var(--site-text);white-space:nowrap}
.st-nav a:hover{background:var(--site-primary-light)}
.st-nav a[aria-current=page]{color:var(--site-primary);background:var(--site-primary-light)}
.st-nav .st-apply{background:var(--site-primary);color:#fff;font-weight:600}
.st-nav .st-apply:hover{background:var(--site-primary);filter:brightness(.92)}
.st-menu{display:none;position:relative}
.st-menu summary{list-style:none;min-height:44px;padding:0 14px;display:inline-flex;align-items:center;gap:8px;border-radius:var(--st-r);font-weight:600;font-size:15px;cursor:pointer;box-shadow:inset 0 0 0 1.5px var(--st-line)}
.st-menu summary::-webkit-details-marker{display:none}
.st-menu nav{position:absolute;right:0;top:calc(100% + 8px);min-width:230px;background:var(--site-background);color:var(--site-text);border-radius:var(--st-r);box-shadow:0 18px 44px -14px rgba(0,0,0,.35),0 0 0 1px var(--st-line);padding:8px;display:grid;z-index:30}
.st-menu nav a{padding:12px 14px;border-radius:calc(var(--st-r) - 4px);text-decoration:none;font-weight:500}
.st-menu nav a[aria-current=page]{background:var(--site-primary-light);color:var(--site-primary)}
@media(max-width:900px){.st-nav{display:none}.st-menu{display:block}.st-topbar span:first-child{display:none}.st-topbar .st-wrap{justify-content:center}}

/* sections */
.st-section{padding:var(--st-pad) 0}
.st-section:nth-of-type(even):not(.st-hero):not(.st-cta){background:var(--site-surface)}
.st-head{margin-bottom:32px;max-width:720px}
.st-head h2{font-size:clamp(26px,3.4vw,38px)}
.st-head p{color:var(--site-muted-text);font-size:17px;margin-top:10px}
.st-eyebrow{font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--site-primary);margin-bottom:16px!important}
.st-sub{font-size:clamp(17px,2vw,20px);margin-top:16px!important;max-width:56ch}

/* inner page banner */
.st-banner{padding:52px 0 44px;background:var(--site-surface)}
.st-banner h1{font-size:clamp(32px,4.6vw,48px)}
.st-crumb{display:flex;gap:8px;font-size:13px;margin-bottom:12px!important;opacity:.8}
.st-crumb a{text-decoration:none}
.st-crumb a:hover{text-decoration:underline}
.st-banner .st-sub{opacity:.85}

/* hero */
.st-hero{padding:80px 0}
.st-hero .st-wrap{display:grid;gap:40px;align-items:center;grid-template-columns:1fr}
.st-hero h1{font-size:clamp(36px,5.4vw,60px);max-width:18ch}
.st-hero-media img{width:100%;height:100%;max-height:440px;object-fit:cover;border-radius:calc(var(--st-r) + 8px);display:block}
@media(min-width:900px){.st-hero.st-has-image .st-wrap{grid-template-columns:1.1fr 1fr}}
/* A hero without a photo still gets depth: three thin rings in the text colour, so it works on light and dark. */
.st-hero,.st-banner{position:relative;overflow:hidden}
.st-hero .st-wrap,.st-banner .st-wrap{position:relative;z-index:1}
.st-hero:not(.st-has-image)::before,.st-banner::before{content:"";position:absolute;right:-140px;top:50%;width:620px;height:620px;transform:translateY(-50%);border-radius:50%;pointer-events:none;opacity:.16;
background:radial-gradient(closest-side,transparent 53%,currentColor 53.4%,currentColor 54.2%,transparent 54.6%,transparent 75%,currentColor 75.4%,currentColor 76.2%,transparent 76.6%,transparent 98%,currentColor 98.4%,currentColor 99.4%,transparent 100%)}
.st-banner::before{width:420px;height:420px;right:-90px}

/* text */
.st-prose{max-width:68ch;display:grid;gap:16px;font-size:17px}
.st-prose h3{font-size:22px;margin-top:8px}
.st-prose ul{margin:0;padding-left:22px;display:grid;gap:8px}
.st-prose li::marker{color:var(--site-primary)}

/* cards */
.st-grid{display:grid;gap:18px;grid-template-columns:repeat(auto-fill,minmax(250px,1fr))}
.st-card,.st-feature{background:var(--site-background);border-radius:var(--st-r);padding:24px;box-shadow:var(--st-shadow)}
.st-card h3,.st-feature h3,.st-step h3{font-size:19px}
.st-card p,.st-feature p,.st-step p{color:var(--site-muted-text);margin-top:8px;font-size:15.5px}
.st-meta{display:block;font-size:13px;font-weight:600;color:var(--site-primary);margin-bottom:6px}
.st-event{display:flex;gap:16px;align-items:flex-start}
.st-date{flex:none;width:64px;text-align:center;border-radius:calc(var(--st-r) - 2px);background:var(--site-primary-light);color:var(--site-primary);padding:8px 4px;line-height:1.15}
.st-date b{display:block;font-size:24px;font-family:var(--st-head)}
.st-date span{font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.st-features{display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(250px,1fr))}
.st-icon{display:flex;width:46px;height:46px;border-radius:calc(var(--st-r) - 2px);align-items:center;justify-content:center;background:var(--site-primary-light);color:var(--site-primary);margin-bottom:16px}
.st-steps{display:grid;gap:24px;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));counter-reset:st;list-style:none;padding:0;margin:0}
.st-step{position:relative;padding-top:60px}
.st-step::before{counter-increment:st;content:counter(st);position:absolute;top:0;left:0;width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--site-primary);color:#fff;font-weight:700;font-family:var(--st-head)}
.st-step::after{content:"";position:absolute;top:21px;left:56px;right:-12px;height:2px;background:var(--st-line)}
.st-step:last-child::after{display:none}
@media(max-width:560px){.st-step::after{display:none}}

.st-stats{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
.st-stat{text-align:center;padding:12px}
.st-stat b{display:block;font-family:var(--st-head);font-size:clamp(32px,4.5vw,48px);color:var(--site-primary);line-height:1.1}
.st-stat span{color:var(--site-muted-text);font-size:15px}

.st-gallery{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}
.st-gallery figure{margin:0}
.st-gallery img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:var(--st-r);display:block;background:var(--site-surface)}
.st-gallery figcaption{font-size:13px;color:var(--site-muted-text);margin-top:6px}

.st-avatar{display:flex;align-items:center;justify-content:center;width:52px;height:52px;border-radius:50%;background:var(--site-primary-light);color:var(--site-primary);font-weight:700;margin-bottom:12px}
.st-quote{font-size:17px;color:var(--site-text)!important;margin-top:0!important}
.st-who{margin-top:14px;font-weight:600;font-size:14px}
.st-who small,.st-sign small{display:block;font-weight:400;color:var(--site-muted-text);font-family:var(--st-body);font-size:14px}
.st-empty{color:var(--site-muted-text);font-size:15px}

.st-split{display:grid;gap:40px;align-items:center}
@media(min-width:900px){.st-split.st-has-image{grid-template-columns:1.1fr 1fr}.st-split.st-left .st-split-media{order:-1}}
.st-split-media img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:calc(var(--st-r) + 6px);display:block}
.st-sign{margin-top:22px!important;font-weight:700;font-family:var(--st-head);font-size:18px}

.st-faq{max-width:820px;display:grid;gap:10px}
.st-faq details{background:var(--site-background);border-radius:var(--st-r);box-shadow:var(--st-shadow);padding:0 20px}
.st-faq summary{list-style:none;cursor:pointer;min-height:58px;display:flex;align-items:center;justify-content:space-between;gap:16px;font-weight:600;font-size:17px;padding:12px 0}
.st-faq summary::-webkit-details-marker{display:none}
.st-faq summary::after{content:"+";font-size:26px;font-weight:400;line-height:1;color:var(--site-primary);flex:none}
.st-faq details[open] summary::after{transform:rotate(45deg)}
.st-faq details p{padding:0 0 18px;color:var(--site-muted-text);max-width:68ch}

.st-table-wrap{overflow-x:auto;border-radius:var(--st-r);box-shadow:var(--st-shadow);background:var(--site-background)}
.st-table{width:100%;border-collapse:collapse;font-size:15.5px;min-width:460px}
.st-table th{text-align:left;font-weight:600;padding:14px 18px;background:var(--site-primary-light);font-size:14px}
.st-table td{padding:14px 18px;border-top:1px solid var(--st-line);vertical-align:top}
.st-table td:first-child{font-weight:600}
.st-view{display:inline-flex;align-items:center;min-height:32px;padding:0 14px;border-radius:999px;background:var(--site-primary-light);color:var(--site-primary)!important;font-weight:600;font-size:14px;text-decoration:none}
.st-note{margin-top:14px!important;font-size:14px;color:var(--site-muted-text)}

.st-links{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));list-style:none;padding:0;margin:0}
.st-links a{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:58px;padding:12px 18px;border-radius:var(--st-r);background:var(--site-background);box-shadow:var(--st-shadow);text-decoration:none;font-weight:600}
.st-links a::after{content:"\\2192";color:var(--site-primary)}
.st-links a:hover{box-shadow:0 0 0 2px var(--site-primary)}

.st-cta{background:var(--st-deep);color:#fff;text-align:center}
.st-cta h2{font-size:clamp(26px,3.6vw,40px)}
.st-cta p{margin:12px auto 0;max-width:56ch;font-size:18px;opacity:.94}
.st-cta .st-btn{margin-top:26px;background:#fff;color:var(--st-deep)}

/* form */
.st-form{display:grid;gap:14px;max-width:760px;grid-template-columns:1fr}
@media(min-width:640px){.st-form{grid-template-columns:1fr 1fr}.st-form .st-full{grid-column:1/-1}}
.st-field{display:grid;align-content:start;gap:6px;font-size:14px;font-weight:600}
.st-input{width:100%;min-height:46px;padding:10px 14px;border-radius:calc(var(--site-radius) + 2px);border:1px solid color-mix(in srgb,var(--site-muted-text) 40%,transparent);background:var(--site-background);color:var(--site-text);font:inherit;font-weight:400}
textarea.st-input{min-height:96px;resize:vertical}
.st-input[aria-invalid=true]{border-color:#b91c1c}
.st-err{color:#991b1b;font-weight:500;font-size:13px}
.st-ok{background:var(--site-secondary-light);color:var(--site-text);padding:20px;border-radius:var(--st-r);max-width:760px}
.st-ok b{display:block;font-size:18px;margin-bottom:4px}
.st-more{grid-column:1/-1;border-radius:calc(var(--site-radius) + 2px);background:var(--site-surface);padding:0 16px}
.st-section:nth-of-type(even) .st-more{background:var(--site-background)}
.st-more summary{min-height:48px;display:flex;align-items:center;cursor:pointer;font-weight:600;font-size:14px}
.st-more .st-form-inner{display:grid;gap:14px;padding:4px 0 16px;grid-template-columns:1fr}
@media(min-width:640px){.st-more .st-form-inner{grid-template-columns:1fr 1fr}.st-more .st-full{grid-column:1/-1}}
.st-hint{font-weight:400;font-size:13px;color:var(--site-muted-text)}
.st-ok a{font-weight:600}
.st-ok .st-btn{margin-top:14px}
.st-hp{position:absolute!important;left:-9999px;width:1px;height:1px;overflow:hidden}

/* contact */
.st-contact{display:grid;gap:28px}
@media(min-width:900px){.st-contact{grid-template-columns:1fr 1.4fr}}
.st-contact dl{display:grid;gap:16px;margin:0;align-content:start}
.st-contact dt{font-size:13px;font-weight:600;color:var(--site-muted-text);text-transform:uppercase;letter-spacing:.04em}
.st-contact dd{margin:2px 0 0;font-size:17px}
.st-map{width:100%;min-height:340px;height:100%;border:0;border-radius:var(--st-r);background:var(--site-surface)}

/* footer */
.st-footer{background:var(--site-surface);margin-top:auto;font-size:15px;color:var(--site-muted-text)}
.st-foot{display:grid;gap:32px;padding-top:52px;padding-bottom:36px}
@media(min-width:900px){.st-foot{grid-template-columns:1.6fr 1fr 1fr}}
.st-foot h3{font-family:var(--st-body);font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--site-text);margin-bottom:14px}
.st-foot ul{list-style:none;padding:0;margin:0;display:grid;gap:8px}
.st-foot a{text-decoration:none}
.st-foot a:hover{text-decoration:underline}
.st-foot-brand{display:grid;gap:4px;align-content:start}
.st-foot-brand b{font-family:var(--st-head);font-size:20px;color:var(--site-text);margin-bottom:8px}
.st-foot-bar{border-top:1px solid var(--st-line);padding-top:18px;padding-bottom:18px;font-size:13.5px}
.st-preview{background:var(--site-accent);color:#111;text-align:center;font-size:14px;font-weight:600;padding:8px 12px}
.st-sticky-apply{display:none}
@media(max-width:720px){.st-sticky-apply{display:inline-flex;position:fixed;left:16px;right:16px;bottom:16px;z-index:30;box-shadow:0 6px 20px rgba(0,0,0,.25)}.st-root{padding-bottom:76px;--st-pad:52px}.st-hero{padding:56px 0}}
@media(prefers-reduced-motion:no-preference){.st-btn{transition:filter .15s}.st-faq summary::after{transition:transform .2s}}

/* ===== Classic: serif, centred crest header, deep colour bands ===== */
[data-template=classic] .st-topbar{display:block;background:var(--st-deep);color:#fff}
[data-template=classic] .st-header{border-bottom:1px solid var(--st-line)}
@media(min-width:901px){[data-template=classic] .st-header .st-wrap{flex-direction:column;padding-top:18px;padding-bottom:10px;gap:10px}[data-template=classic] .st-brand{font-size:26px}}
[data-template=classic] .st-hero,[data-template=classic] .st-banner{background:radial-gradient(900px 480px at 12% -10%,color-mix(in srgb,var(--site-primary) 85%,#fff),transparent 60%),linear-gradient(135deg,var(--st-deep),color-mix(in srgb,var(--st-deep) 70%,#000));color:#fff}
[data-template=classic] .st-hero h1{font-weight:600}
[data-template=classic] .st-hero{padding:96px 0}
[data-template=classic] .st-banner{text-align:center}
[data-template=classic] .st-banner .st-crumb{justify-content:center}
[data-template=classic] .st-banner .st-sub{margin-inline:auto}
[data-template=classic] .st-hero .st-eyebrow{color:#fff;opacity:.85}
[data-template=classic] .st-hero .st-btn{background:#fff;color:var(--st-deep)}
[data-template=classic] .st-hero .st-btn.st-ghost{background:transparent;color:#fff;box-shadow:inset 0 0 0 2px rgba(255,255,255,.8)}
[data-template=classic] .st-hero-media img{box-shadow:0 0 0 6px rgba(255,255,255,.18)}
[data-template=classic] .st-head{text-align:center;margin-inline:auto}
[data-template=classic] .st-head h2::after{content:"";display:block;width:56px;height:3px;background:var(--site-accent);margin:14px auto 0}
[data-template=classic] .st-prose,[data-template=classic] .st-faq,[data-template=classic] .st-form,[data-template=classic] .st-ok{margin-inline:auto}
[data-template=classic] .st-feature{text-align:center}
[data-template=classic] .st-icon{margin-inline:auto;border-radius:50%}
[data-template=classic] .st-footer{background:var(--st-deep);color:rgba(255,255,255,.86)}
[data-template=classic] .st-foot h3,[data-template=classic] .st-foot-brand b{color:#fff}
[data-template=classic] .st-foot-bar{border-color:rgba(255,255,255,.2)}

/* ===== Modern: bold sans, soft cards, pill menu ===== */
[data-template=modern]{--st-r:calc(var(--site-radius) + 10px);--st-shadow:0 10px 30px -14px rgba(0,0,0,.2),0 0 0 1px color-mix(in srgb,var(--site-text) 6%,transparent)}
[data-template=modern] .st-header{background:color-mix(in srgb,var(--site-background) 88%,transparent);backdrop-filter:saturate(1.4) blur(10px)}
[data-template=modern] .st-nav{background:var(--site-surface);padding:4px;border-radius:999px}
[data-template=modern] .st-nav a,[data-template=modern] .st-btn{border-radius:999px}
[data-template=modern] .st-hero,[data-template=modern] .st-banner{background:linear-gradient(180deg,var(--site-primary-light),var(--site-background))}
[data-template=modern] .st-hero h1,[data-template=modern] .st-banner h1{font-weight:800;letter-spacing:-0.03em}
[data-template=modern] .st-eyebrow{display:inline-block;background:var(--site-background);padding:6px 14px;border-radius:999px;box-shadow:var(--st-shadow)}
[data-template=modern] .st-hero-media{position:relative}
[data-template=modern] .st-hero-media::before{content:"";position:absolute;inset:18px -14px -14px 18px;border-radius:32px;background:var(--site-accent-light);z-index:0}
[data-template=modern] .st-hero-media img{position:relative;border-radius:32px}
[data-template=modern] .st-stats{background:var(--site-background);border-radius:28px;box-shadow:var(--st-shadow);padding:20px}
[data-template=modern] .st-cta{background:transparent;color:var(--site-text)}
[data-template=modern] .st-cta-box{background:var(--st-dark);color:#fff;border-radius:36px;padding:56px 24px}
[data-template=modern] .st-cta .st-btn{color:var(--st-dark)}
[data-template=modern] .st-footer{background:var(--site-surface)}

/* ===== Minimal: quiet, text-first ===== */
[data-template=minimal]{--st-pad:56px;--st-shadow:none}
[data-template=minimal] .st-header{border-bottom:1px solid var(--st-line)}
[data-template=minimal] .st-brand{font-weight:600;font-size:17px}
[data-template=minimal] .st-nav a{padding:6px 10px;border-radius:0;font-size:14px}
[data-template=minimal] .st-nav a:hover,[data-template=minimal] .st-nav a[aria-current=page]{background:none;text-decoration:underline;text-underline-offset:6px}
[data-template=minimal] .st-nav .st-apply{padding:6px 14px;border-radius:999px}
[data-template=minimal] .st-nav .st-apply:hover{text-decoration:none;background:var(--site-primary)}
[data-template=minimal] .st-section:nth-of-type(even):not(.st-hero):not(.st-cta){background:transparent}
[data-template=minimal] .st-section+.st-section{border-top:1px solid var(--st-line)}
[data-template=minimal] .st-head h2{font-size:clamp(22px,2.6vw,30px);font-weight:600}
[data-template=minimal] .st-banner{background:transparent;border-bottom:1px solid var(--st-line);padding:64px 0 36px}
[data-template=minimal] .st-hero{padding:88px 0 56px}
[data-template=minimal] .st-hero h1,[data-template=minimal] .st-banner h1{font-weight:600;font-size:clamp(30px,4.4vw,48px)}
[data-template=minimal] .st-hero .st-btn:not(.st-ghost){background:var(--site-text)}
[data-template=minimal] .st-hero .st-btn.st-ghost{box-shadow:none;text-decoration:underline;text-underline-offset:6px;padding:0 8px}
[data-template=minimal] .st-card,[data-template=minimal] .st-feature{padding:0 0 18px;border-radius:0;border-bottom:1px solid var(--st-line);background:transparent}
[data-template=minimal] .st-icon{background:transparent;width:auto;height:auto;justify-content:flex-start}
[data-template=minimal] .st-stat{text-align:left;padding-left:0}
[data-template=minimal] .st-faq details,[data-template=minimal] .st-links a{border-radius:0;border-bottom:1px solid var(--st-line);padding-inline:0;background:transparent}
[data-template=minimal] .st-table-wrap{box-shadow:0 0 0 1px var(--st-line)}
[data-template=minimal] .st-table th{background:transparent;border-bottom:2px solid var(--site-text)}
[data-template=minimal] .st-cta{background:transparent;color:var(--site-text);text-align:left}
[data-template=minimal] .st-cta p{margin-inline:0;color:var(--site-muted-text)}
[data-template=minimal] .st-cta .st-btn{background:var(--site-text);color:var(--site-background)}
[data-template=minimal] .st-footer{background:transparent;border-top:1px solid var(--st-line)}

/* ===== Campus: full-width photo hero, colour bands, dark footer ===== */
[data-template=campus]{--st-r:calc(var(--site-radius) + 2px)}
[data-template=campus] .st-topbar{display:block;background:var(--st-dark);color:#fff}
[data-template=campus] .st-header{box-shadow:0 1px 0 var(--st-line)}
[data-template=campus] .st-brand{font-size:21px;letter-spacing:-0.01em}
[data-template=campus] .st-nav a{border-radius:4px;font-weight:600;font-size:14.5px}
[data-template=campus] .st-hero{position:relative;overflow:hidden;background:var(--st-dark);color:#fff;padding:0}
[data-template=campus] .st-hero .st-wrap{position:static;display:flex;align-items:flex-end;min-height:min(78vh,640px);padding-top:110px;padding-bottom:76px}
[data-template=campus] .st-hero-media img{position:absolute;inset:0;width:100%;height:100%;max-height:none;border-radius:0}
[data-template=campus] .st-hero::after{content:"";position:absolute;inset:0;background:radial-gradient(900px 520px at 88% 0%,color-mix(in srgb,var(--site-primary) 60%,transparent),transparent 70%)}
[data-template=campus] .st-hero.st-has-image::after{background:linear-gradient(180deg,color-mix(in srgb,var(--st-dark) 30%,transparent),color-mix(in srgb,var(--st-dark) 90%,transparent))}
[data-template=campus] .st-hero-copy{position:relative;z-index:2;max-width:780px}
[data-template=campus] .st-hero h1{font-weight:700;letter-spacing:-0.02em;max-width:20ch}
[data-template=campus] .st-hero .st-eyebrow{color:#fff}
[data-template=campus] .st-hero .st-eyebrow::before{content:"";display:inline-block;width:32px;height:3px;background:var(--site-accent);vertical-align:middle;margin-right:12px}
[data-template=campus] .st-hero .st-btn.st-ghost{color:#fff;box-shadow:inset 0 0 0 2px rgba(255,255,255,.8)}
[data-template=campus] .st-stats{gap:0}
[data-template=campus] .st-sec-stats{background:var(--st-deep)!important;padding:34px 0}
[data-template=campus] .st-stat b{color:#fff}
[data-template=campus] .st-stat span{color:#fff;font-weight:600}
[data-template=campus] .st-banner{background:var(--st-dark);color:#fff;padding:64px 0 52px}
[data-template=campus] .st-head h2::before{content:"";display:block;width:40px;height:4px;background:var(--site-accent);margin-bottom:16px}
[data-template=campus] .st-head h2{font-weight:700;letter-spacing:-0.02em}
[data-template=campus] .st-footer{background:var(--st-dark);color:rgba(255,255,255,.8)}
[data-template=campus] .st-foot h3,[data-template=campus] .st-foot-brand b{color:#fff}
[data-template=campus] .st-foot-bar{border-color:rgba(255,255,255,.16)}

/* ===== Playful: rounded shapes, warm colour blocks, chunky buttons ===== */
[data-template=playful]{--st-r:26px;--st-shadow:none}
[data-template=playful] .st-root h1,[data-template=playful] h1,[data-template=playful] h2,[data-template=playful] h3{font-weight:800}
[data-template=playful] .st-btn{border-radius:999px;min-height:50px;box-shadow:0 5px 0 color-mix(in srgb,var(--site-primary) 70%,#000)}
[data-template=playful] .st-btn:active{transform:translateY(3px);box-shadow:0 2px 0 color-mix(in srgb,var(--site-primary) 70%,#000)}
[data-template=playful] .st-btn.st-ghost{background:var(--site-background);box-shadow:inset 0 0 0 2px var(--site-primary),0 5px 0 var(--site-primary-light)}
[data-template=playful] .st-nav a{border-radius:999px;font-weight:700}
[data-template=playful] .st-nav .st-apply{box-shadow:0 3px 0 color-mix(in srgb,var(--site-primary) 70%,#000)}
[data-template=playful] .st-hero,[data-template=playful] .st-banner{background:radial-gradient(260px 260px at 6% 12%,var(--site-secondary-light) 99%,transparent),radial-gradient(180px 180px at 96% 90%,var(--site-primary-light) 99%,transparent),var(--site-accent-light);border-radius:0 0 48px 48px}
[data-template=playful] .st-eyebrow{display:inline-block;background:var(--site-background);padding:7px 16px;border-radius:999px;color:var(--site-text)}
[data-template=playful] .st-hero-media img{border-radius:46% 54% 52% 48%/50% 44% 56% 50%;aspect-ratio:1/1;max-height:460px;box-shadow:0 0 0 10px var(--site-background)}
[data-template=playful] .st-section:nth-of-type(even):not(.st-hero):not(.st-cta){background:transparent}
[data-template=playful] .st-card,[data-template=playful] .st-feature{background:var(--site-primary-light)}
[data-template=playful] .st-grid>:nth-child(3n+2),[data-template=playful] .st-features>:nth-child(3n+2){background:var(--site-accent-light)}
[data-template=playful] .st-grid>:nth-child(3n),[data-template=playful] .st-features>:nth-child(3n){background:var(--site-secondary-light)}
[data-template=playful] .st-icon,[data-template=playful] .st-date,[data-template=playful] .st-avatar{background:var(--site-background);border-radius:50%}
[data-template=playful] .st-date{border-radius:20px}
[data-template=playful] .st-stat{background:var(--site-surface);border-radius:26px;padding:22px 12px}
[data-template=playful] .st-faq details,[data-template=playful] .st-links a,[data-template=playful] .st-table-wrap{box-shadow:0 0 0 2px var(--site-primary-light)}
[data-template=playful] .st-cta{background:transparent;color:var(--site-text)}
[data-template=playful] .st-cta-box{background:var(--site-secondary-light);border-radius:44px;padding:56px 24px}
[data-template=playful] .st-cta .st-btn{background:var(--site-primary);color:#fff}
[data-template=playful] .st-footer{background:var(--site-primary-light);border-radius:48px 48px 0 0;color:var(--site-text)}
`;
