<script setup lang="ts">
/**
 * Período dos relatórios: atalhos comuns + datas livres. Datas sempre em dias
 * de Brasília (YYYY-MM-DD), que é o que o servidor espera.
 */
const de = defineModel<string>('de', { required: true })
const ate = defineModel<string>('ate', { required: true })

const hoje = () => dataSP()
function diasAtras(n: number) {
  return dataSP(new Date(Date.now() - n * 86_400_000))
}
function inicioDoMes(deslocamento = 0) {
  const p = partesSP()
  const d = new Date(Date.UTC(Number(p.ano), Number(p.mes) - 1 + deslocamento, 1))
  return d.toISOString().slice(0, 10)
}
function fimDoMes(deslocamento = 0) {
  const p = partesSP()
  const d = new Date(Date.UTC(Number(p.ano), Number(p.mes) + deslocamento, 0))
  return d.toISOString().slice(0, 10)
}

const ATALHOS = [
  { rotulo: '30 dias', de: () => diasAtras(29), ate: hoje },
  { rotulo: 'Este mês', de: () => inicioDoMes(0), ate: hoje },
  { rotulo: 'Mês passado', de: () => inicioDoMes(-1), ate: () => fimDoMes(-1) },
  { rotulo: '90 dias', de: () => diasAtras(89), ate: hoje }
]
const ativo = computed(() => ATALHOS.find(a => a.de() === de.value && a.ate() === ate.value)?.rotulo ?? null)
</script>

<template>
  <div class="flex flex-wrap items-end gap-2">
    <UFieldGroup size="sm">
      <UButton
        v-for="a in ATALHOS"
        :key="a.rotulo"
        :label="a.rotulo"
        :color="ativo === a.rotulo ? 'primary' : 'neutral'"
        :variant="ativo === a.rotulo ? 'soft' : 'outline'"
        @click="de = a.de(); ate = a.ate()"
      />
    </UFieldGroup>
    <UInput v-model="de" type="date" size="sm" class="w-40" aria-label="De" />
    <span class="pb-1.5 text-xs text-muted">até</span>
    <UInput v-model="ate" type="date" size="sm" class="w-40" aria-label="Até" />
  </div>
</template>
