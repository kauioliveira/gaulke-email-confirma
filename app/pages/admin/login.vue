<script setup lang="ts">
definePageMeta({ layout: false })
useHead({ title: 'Entrar — Gaulke Envios' })

const route = useRoute()
const toast = useToast()
const senha = ref('')
const carregando = ref(false)

async function entrar() {
  if (!senha.value) return
  carregando.value = true
  try {
    await $fetch('/api/admin/login', { method: 'POST', body: { senha: senha.value } })
    await navigateTo(String(route.query.redirect || '/admin/lotes'))
  } catch (e: any) {
    toast.add({
      title: 'Não foi possível entrar',
      description: e?.statusMessage || 'Verifique a senha e tente novamente.',
      color: 'error'
    })
    senha.value = ''
  } finally {
    carregando.value = false
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-elevated/40 px-4">
    <UCard class="w-full max-w-sm">
      <template #header>
        <div class="flex items-center gap-3">
          <UIcon name="i-lucide-mail-check" class="size-8 text-primary" />
          <div>
            <p class="font-semibold">Gaulke · Envios</p>
            <p class="text-sm text-muted">Área administrativa</p>
          </div>
        </div>
      </template>

      <form class="space-y-4" @submit.prevent="entrar">
        <UFormField label="Senha de acesso" name="senha">
          <UInput
            v-model="senha"
            type="password"
            placeholder="••••••••"
            autocomplete="current-password"
            autofocus
            class="w-full"
          />
        </UFormField>
        <UButton
          type="submit"
          label="Entrar"
          icon="i-lucide-log-in"
          block
          :loading="carregando"
          :disabled="!senha"
        />
      </form>

      <template #footer>
        <p class="text-xs text-muted">
          Esta área contém dados pessoais de destinatários (e-mail e IP). O acesso é restrito.
        </p>
      </template>
    </UCard>
  </div>
</template>
