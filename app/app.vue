<template>
  <!--
    Toasts no topo, e nao no canto inferior direito (padrao).
    La embaixo eles cobriam o botao flutuante do WhatsApp na pagina do
    destinatario — logo depois de confirmar a leitura, que e exatamente
    quando a pessoa pode precisar falar com a empresa.
  -->
  <UApp :toaster="{ position: 'top-right' }">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
