<script setup lang="ts">
import type { Bloco, FormatoTemplate } from '~~/shared/types/blocos'

/**
 * Editor do e-mail, em três modos.
 *
 * VISUAL é o padrão: a pessoa monta com blocos e o HTML de tabelas é gerado no
 * servidor. HTML existe para quem quiser ver ou colar marcação pronta. O
 * preview é sempre renderizado pelo servidor, pela MESMA função usada no envio
 * real — o que aparece aqui é o que o destinatário recebe.
 */
const props = defineProps<{ assunto: string; arquivos?: { nome: string }[] }>()

const formato = defineModel<FormatoTemplate>('formato', { required: true })
const blocos = defineModel<Bloco[]>('blocos', { required: true })
const html = defineModel<string>('html', { required: true })

const toast = useToast()
const aba = ref<'editar' | 'html' | 'preview'>('editar')
const preview = ref({ html: '', assunto: '', fonte: '' })
const carregando = ref(false)
const larguraPreview = ref<'desktop' | 'mobile'>('desktop')

const VARIAVEIS_HTML: { chave: string; rotulo?: string; desc: string }[] = [
  { chave: '{{nome}}', desc: 'Nome do destinatário' },
  { chave: '{{empresa}}', desc: 'Empresa do destinatário' },
  { chave: '{{email}}', desc: 'E-mail do destinatário' },
  { chave: '{{codigo}}', desc: 'Código único (ex: GLK-7F3K-2M9Q)' },
  { chave: '{{link}}', desc: 'Link individual de acesso' },
  { chave: '{{logo}}', desc: 'Logo da empresa (URL pública)' },
  { chave: '{{pixel}}', desc: 'Pixel de abertura (inserido automaticamente)' },
  {
    chave: '{{#empresa}}texto{{/empresa}}',
    rotulo: '{{#empresa}}…{{/empresa}}',
    desc: 'Trecho opcional: só aparece se a empresa do destinatário estiver preenchida (troque "texto" pelo conteúdo)'
  }
]

/** O corpo enviado ao preview muda conforme o modo, mas o endpoint é o mesmo. */
function corpoPreview() {
  return formato.value === 'blocos'
    ? { blocos: blocos.value, assunto: props.assunto }
    : { html: html.value, assunto: props.assunto }
}

async function atualizarPreview() {
  carregando.value = true
  try {
    preview.value = await $fetch(api('/api/admin/preview'), {
      method: 'POST',
      body: corpoPreview()
    })
  } catch (e: any) {
    toast.add({
      title: 'Falha ao gerar o preview',
      description: e?.statusMessage,
      color: 'error'
    })
  } finally {
    carregando.value = false
  }
}

watch(aba, a => {
  if (a === 'preview' || (a === 'html' && formato.value === 'blocos')) atualizarPreview()
})

function copiarHtml() {
  navigator.clipboard?.writeText(preview.value.fonte)
  toast.add({ title: 'HTML copiado', color: 'success' })
}

function inserirNoHtml(v: string) {
  html.value += v
  toast.add({ title: `${v} inserido no fim do HTML`, color: 'info' })
}

/**
 * Caminho de mão única, e por isso pergunta antes: o HTML gerado passa a ser
 * editado à mão e os blocos deixam de existir. Voltar exigiria remontar tudo.
 */
async function converterParaHtml() {
  if (!preview.value.fonte) await atualizarPreview()
  if (!preview.value.fonte) return

  if (!confirm(
    'Converter para HTML livre?\n\n' +
    'Você passa a editar a marcação à mão e o editor visual deixa de valer para ' +
    'este template. Não dá para voltar automaticamente.'
  )) return

  html.value = preview.value.fonte
  formato.value = 'html'
  aba.value = 'html'
  toast.add({ title: 'Convertido para HTML livre', color: 'success' })
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <UFieldGroup size="sm">
        <UButton
          label="Visual"
          icon="i-lucide-layout-list"
          :color="aba === 'editar' ? 'primary' : 'neutral'"
          :variant="aba === 'editar' ? 'solid' : 'outline'"
          @click="aba = 'editar'"
        />
        <UButton
          label="HTML"
          icon="i-lucide-code"
          :color="aba === 'html' ? 'primary' : 'neutral'"
          :variant="aba === 'html' ? 'solid' : 'outline'"
          @click="aba = 'html'"
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
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          :loading="carregando"
          @click="atualizarPreview"
        />
      </UFieldGroup>
    </div>

    <!-- VISUAL -->
    <div v-show="aba === 'editar'">
      <EditorBlocos v-if="formato === 'blocos'" v-model="blocos" :arquivos="arquivos" />

      <!-- template em HTML livre: o editor visual não se aplica -->
      <UAlert
        v-else
        color="neutral"
        variant="subtle"
        icon="i-lucide-code"
        title="Este template é HTML livre"
        description="Ele foi escrito à mão, então o editor visual não se aplica. Use a aba HTML, ou crie um template novo para montar por blocos."
      />
    </div>

    <!-- HTML -->
    <div v-show="aba === 'html'" class="space-y-3">
      <template v-if="formato === 'blocos'">
        <UAlert
          color="info"
          variant="subtle"
          icon="i-lucide-info"
          title="HTML gerado pelos blocos"
          description="Somente leitura: quem manda é o editor visual. Isto é exatamente o que será enviado, com as variáveis ainda no lugar."
        />
        <UTextarea
          :model-value="preview.fonte"
          :rows="20"
          readonly
          class="w-full"
          :ui="{ base: 'font-mono text-xs leading-relaxed' }"
        />
        <div class="flex flex-wrap gap-2">
          <UButton
            label="Copiar HTML"
            icon="i-lucide-copy"
            size="xs"
            color="neutral"
            variant="outline"
            @click="copiarHtml"
          />
          <UButton
            label="Converter para HTML livre"
            icon="i-lucide-file-code-2"
            size="xs"
            color="neutral"
            variant="outline"
            @click="converterParaHtml"
          />
        </div>
      </template>

      <template v-else>
        <UTextarea
          v-model="html"
          :rows="22"
          class="w-full"
          :ui="{ base: 'font-mono text-xs leading-relaxed' }"
          placeholder="Cole aqui o HTML do e-mail..."
          spellcheck="false"
        />
        <div class="rounded-lg border border-default p-3">
          <p class="mb-2 text-xs font-medium text-muted">
            Variáveis disponíveis — clique para inserir no fim do HTML
          </p>
          <div class="flex flex-wrap gap-2">
            <UTooltip v-for="v in VARIAVEIS_HTML" :key="v.chave" :text="v.desc">
              <UButton
                size="xs"
                color="neutral"
                variant="outline"
                class="font-mono"
                :label="v.rotulo || v.chave"
                @click="inserirNoHtml(v.chave)"
              />
            </UTooltip>
          </div>
        </div>
      </template>
    </div>

    <!-- PREVIEW -->
    <div v-show="aba === 'preview'" class="space-y-2">
      <div class="rounded-t-lg border border-default bg-elevated/50 px-4 py-2 text-sm">
        <span class="text-muted">Assunto:</span>
        <span class="font-medium">{{ preview.assunto || '—' }}</span>
      </div>
      <!--
        Sempre claro, mesmo com o painel no tema escuro: o e-mail é enviado com
        fundo claro, e mostrá-lo sobre uma moldura escura dá uma ideia errada
        de como ele vai chegar.
      -->
      <div class="flex justify-center rounded-b-lg border border-t-0 border-default bg-white p-4">
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
