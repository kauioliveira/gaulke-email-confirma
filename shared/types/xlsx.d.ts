/**
 * O pacote xlsx declara os tipos so para o entrypoint principal. Importamos o
 * build ESM por caminho (veja o comentario em server/utils/lista.ts), entao a
 * declaracao abaixo reaproveita os mesmos tipos para esse especificador.
 */
declare module 'xlsx/xlsx.mjs' {
  export * from 'xlsx'
}
