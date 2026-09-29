export default defineAppConfig({
  ui: {
    // marca Gaulke — #343881
    colors: { primary: 'gaulke', neutral: 'slate' },
    /**
     * Modais mais largos que o padrão do Nuxt UI (max-w-lg, 512px): os
     * nossos mostram resumos de envio e formulários com rótulo e valor lado
     * a lado, que ficavam espremidos. Vale para todos de uma vez.
     */
    modal: {
      variants: {
        fullscreen: {
          false: { content: 'w-[calc(100vw-2rem)] max-w-2xl rounded-lg shadow-lg ring ring-default' }
        }
      }
    }
  }
})
