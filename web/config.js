// Onde está o servidor. No PC da casa (http://192.168…:8765) fica vazio e o app usa /api/ da mesma
// origem. Publicado na Vercel, fala com a edge function do Supabase. A chave abaixo é a PUBLICÁVEL
// (feita para ir no navegador); o acesso aos dados é pelo token de cada aparelho.
window.PAINEL = location.hostname.endsWith('.vercel.app') ? {
  api: 'https://xbzeoueiipieoadidibc.supabase.co/functions/v1/api',
  supabaseUrl: 'https://xbzeoueiipieoadidibc.supabase.co',
  supabaseKey: 'sb_publishable_NKOHerqU71SGXynQ0JtWpA_lq6EKiPi',
} : {};