# Ligar o modo ROTEIRO FIXO na conta do Luiz

⚠️ **Só funciona DEPOIS do backend estar publicado no Render** (a migration precisa
ter rodado). Antes disso o comando roda sem erro mas não liga nada — o próprio
comando avisa se isso acontecer.

## Como usar

1. Abra o AdsGenius no navegador e entre no módulo **Meta Ads** (precisa estar logado ali).
2. Abra o console do navegador: **F12** → aba **Console**.
3. Cole o bloco abaixo inteiro e aperte Enter.

O comando **lê a configuração atual e só acrescenta o roteiro** — sua persona,
o número conectado, o contato do vendedor e o liga/desliga do bot ficam como
estão. Nenhuma senha ou chave aparece no comando nem no que ele imprime.

```js
(async()=>{const t=sessionStorage.getItem('meta_token');if(!t)return console.log('❌ Entre no módulo Meta Ads primeiro.');const H={'Content-Type':'application/json',Authorization:'Bearer '+t};let B=null,biz=null;for(const b of['/meta-api','https://meta-ads-agent-backend.onrender.com/api']){try{const r=await fetch(b+'/whatsapp/businesses',{headers:H});if(r.ok){B=b;biz=await r.json();break}}catch(e){}}if(!B)return console.log('❌ Não consegui falar com o backend.');if(!biz||!biz.length)return console.log('❌ Nenhum negócio de WhatsApp configurado.');if(biz.length>1)return console.log('Vários negócios — me diga qual:',biz.map(x=>x.businessId+' = '+x.businessName));const id=biz[0].businessId,q='?businessId='+encodeURIComponent(id);const cfg=await(await fetch(B+'/whatsapp/config'+q,{headers:H})).json();if(!cfg)return console.log('❌ Configure o bot pela tela antes de ligar o roteiro.');const R={scriptEnabled:true,scriptIntro:'Olá, meu nome é Luiz Cláudio Brito, corretor de seguros e planos de saúde.',scriptClosing:'Obrigado! Já tenho suas informações e vou preparar as opções. Te retorno aqui em breve.',scriptSteps:[{pergunta:'É para você/sua família ou para uma empresa (CNPJ)?',campo:'tipo'},{pergunta:'Quantas pessoas vão entrar no plano?',campo:'vidas'},{pergunta:'Qual a idade de cada uma? (se for empresa: quantos funcionários?)',campo:'idades'},{pergunta:'Já tem plano hoje? Qual?',campo:'plano_atual'},{pergunta:'Pretende contratar nos próximos dias ou está só pesquisando?',campo:'urgencia'}]};await fetch(B+'/whatsapp/config',{method:'POST',headers:H,body:JSON.stringify({...cfg,businessId:id,...R})});const ok=await(await fetch(B+'/whatsapp/config'+q,{headers:H})).json();if(ok.scriptEnabled!==true)return console.log('❌ O backend ainda não tem o modo roteiro — publique antes e rode de novo.');console.log('✅ Negócio: '+ok.businessName+' | bot ativo: '+ok.enabled+' | perguntas: '+(ok.scriptSteps||[]).length);console.log('— '+ok.scriptIntro);(ok.scriptSteps||[]).forEach((p,i)=>console.log('— '+(i+1)+'. '+p.pergunta));console.log('— (no fim) '+ok.scriptClosing)})()
```

## O que ele deve imprimir

```
✅ Negócio: ... | bot ativo: true | perguntas: 5
— Olá, meu nome é Luiz Cláudio Brito, corretor de seguros e planos de saúde.
— 1. É para você/sua família ou para uma empresa (CNPJ)?
— 2. Quantas pessoas vão entrar no plano?
— 3. Qual a idade de cada uma? (se for empresa: quantos funcionários?)
— 4. Já tem plano hoje? Qual?
— 5. Pretende contratar nos próximos dias ou está só pesquisando?
— (no fim) Obrigado! Já tenho suas informações e vou preparar as opções. Te retorno aqui em breve.
```

Se aparecer `❌ O backend ainda não tem o modo roteiro`, o deploy ainda não subiu.

## Para desligar (volta ao bot de antes)

Mesmo lugar, cole isto:

```js
(async()=>{const t=sessionStorage.getItem('meta_token');const H={'Content-Type':'application/json',Authorization:'Bearer '+t};let B=null,biz=null;for(const b of['/meta-api','https://meta-ads-agent-backend.onrender.com/api']){try{const r=await fetch(b+'/whatsapp/businesses',{headers:H});if(r.ok){B=b;biz=await r.json();break}}catch(e){}}const id=biz[0].businessId,q='?businessId='+encodeURIComponent(id);const cfg=await(await fetch(B+'/whatsapp/config'+q,{headers:H})).json();await fetch(B+'/whatsapp/config',{method:'POST',headers:H,body:JSON.stringify({...cfg,businessId:id,scriptEnabled:false})});const ok=await(await fetch(B+'/whatsapp/config'+q,{headers:H})).json();console.log('roteiro ligado:',ok.scriptEnabled)})()
```

O roteiro fica guardado — desligar não apaga as perguntas.
