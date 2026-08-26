<script setup lang="ts">
/**
 * Editor de HTML com preview visual lado a lado. O preview e renderizado
 * pelo servidor (mesma funcao usada no envio real), entao o que aparece
 * aqui e exatamente o que o destinatario vai receber.
 */
const props = defineProps<{ assunto: string }>()
const html = defineModel<string>({ required: true })

const toast = useToast()
const aba = ref<'editar' | 'preview'>('editar')
const preview = ref({ html: '', assunto: '' })
const carregando = ref(false)
const larguraPreview = ref<'desktop' | 'mobile'>('desktop')

const VARIAVEIS = [
  { chave: '{{nome}}', desc: 'Nome do destinatário' },
  { chave: '{{empresa}}', desc: 'Empresa do destinatário' },
  { chave: '{{email}}', desc: 'E-mail do destinatário' },
  { chave: '{{codigo}}', desc: 'Código único (ex: GLK-7F3K-2M9Q)' },
  { chave: '{{link}}', desc: 'Link individual de acesso' },
  { chave: '{{logo}}', desc: 'Logo da empresa (URL pública)' },
  { chave: '{{pixel}}', desc: 'Pixel de abertura (inserido automaticamente)' }
]

async function atualizarPreview() {
  carregando.value = true
  try {
    preview.value = await $fetch('/api/admin/preview', {
      method: 'POST',
      body: { html: html.value, assunto: props.assunto }
    })
  } catch {
    toast.add({ title: 'Falha ao gerar o preview', color: 'error' })
  } finally {
    carregando.value = false
  }
}

watch(aba, a => {
  if (a === 'preview') atualizarPreview()
})

function inserir(v: string) {
  html.value += v
  toast.add({ title: `${v} copiado para o fim do HTML`, color: 'info' })
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <UFieldGroup size="sm">
        <UButton
          label="Editar HTML"
          icon="i-lucide-code"
          :color="aba === 'editar' ? 'primary' : 'neutral'"
          :variant="aba === 'editar' ? 'solid' : 'outline'"
          @click="aba = 'editar'"
        />
        <UButton
          label="Ver como fica"
          icon="i-lucide-eye"
          :color="aba === 'preview' ? 'primary' : 'neutral'"
          :variant="aba === 'preview' ? 'solid' : 'outline'"
          @click="aba = 'preview'"
        />
      </UFieldGroup>

      <UFieldGroup v-if="aba === 'preview'" size="sm">
        <UButton
          icon="i-lucide-monitor"
          :color="larguraPreview === 'desktop' ? 'primary' : 'neutral'"
          variant="outline"
          @click="larguraPreview = 'desktop'"
        />
        <UButton
          icon="i-lucide-smartphone"
          :color="larguraPreview === 'mobile' ? 'primary' : 'neutral'"
          variant="outline"
          @click="larguraPreview = 'mobile'"
        />
        <UButton icon="i-lucide-refresh-cw" color="neutral" variant="outline" :loading="carregando" @click="atualizarPreview" />
      </UFieldGroup>
    </div>

    <!-- Modo edicao -->
    <div v-show="aba === 'editar'" class="space-y-3">
      <UTextarea
        v-model="html"
        :rows="22"
        class="w-full font-mono"
        :ui="{ base: 'font-mono text-xs leading-relaxed' }"
        placeholder="Cole aqui o HTML do e-mail..."
        spellcheck="false"
      />

      <div class="rounded-lg border border-default p-3">
        <p class="mb-2 text-xs font-medium text-muted">
          Variáveis disponíveis — clique para inserir no fim do HTML
        </p>
        <div class="flex flex-wrap gap-2">
          <UTooltip v-for="v in VARIAVEIS" :key="v.chave" :text="v.desc">
            <UButton
              size="xs"
              color="neutral"
              variant="outline"
              class="font-mono"
              :label="v.chave"
              @click="inserir(v.chave)"
            />
          </UTooltip>
        </div>
      </div>
    </div>

    <!-- Modo preview -->
    <div v-show="aba === 'preview'" class="space-y-2">
      <div class="rounded-t-lg border border-default bg-elevated/50 px-4 py-2 text-sm">
        <span class="text-muted">Assunto:</span>
        <span class="font-medium">{{ preview.assunto || '—' }}</span>
      </div>
      <div class="flex justify-center rounded-b-lg border border-t-0 border-default bg-white p-4 dark:bg-neutral-900">
        <iframe
          :srcdoc="preview.html"
          sandbox=""
          class="h-[640px] w-full rounded border border-default bg-white transition-all"
          :class="larguraPreview === 'mobile' ? 'max-w-[400px]' : ''"
          title="Pré-visualização do e-mail"
        />
      </div>
      <p class="text-center text-xs text-muted">
        Preview com dados fictícios. O pixel de rastreio é inserido automaticamente no envio.
      </p>
    </div>
  </div>
</template>
