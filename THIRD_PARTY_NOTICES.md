# Avisos de terceiros

Este documento reúne atribuições relevantes para uso da interface e recursos gerados. Não define a licença do Elyra. As licenças, copyrights e notices fornecidos nos pacotes npm devem acompanhar qualquer redistribuição desses pacotes ou artefatos derivados.

## Mapas

A interface usa MapLibre GL JS e, quando configurada, estilos/tiles OpenFreeMap com dados OpenStreetMap. Preserve o controle de atribuição no mapa e os créditos de cada serviço. Créditos: **OpenFreeMap, OpenMapTiles e © OpenStreetMap contributors**. Dados OpenStreetMap possuem obrigações próprias sob ODbL; não se confundem com a licença da biblioteca MapLibre. O pacote não inclui uma cópia da base geográfica.

Fontes: [OpenFreeMap](https://openfreemap.org/quick_start/), [OpenStreetMap copyright](https://www.openstreetmap.org/copyright), [licença MapLibre](https://github.com/maplibre/maplibre-gl-js/blob/main/LICENSE.txt). O worker preparado por `prebuild` é derivado do pacote MapLibre; preserve o aviso da biblioteca ao distribuir esse artefato.

## Fonte Inter

A interface solicita Inter via `next/font`. Inter é fornecida sob SIL Open Font License 1.1. Ao redistribuir os arquivos da fonte ou um build que os inclua, preserve o copyright e o texto de licença que acompanha a fonte, e observe as condições sobre nomes reservados. Não há arquivo de fonte embutido no payload fonte deste snapshot.

Fonte: [Inter e sua licença](https://github.com/rsms/inter/blob/master/LICENSE.txt).

## Bibliotecas e recursos opcionais

Dependências são instaladas do registro conforme `package-lock.json`. Não foram copiados diretórios `node_modules`, pesos neurais ou bibliotecas binárias para este pacote fonte. Bibliotecas, modelos, datasets e assets possuem licenças separadas. Antes de redistribuir pesos obtidos pelos scripts opcionais, verifique os termos do modelo específico. Uma licença de Transformers.js ou MediaPipe não comprova direitos de um peso neural.

A atribuição de artigos às fontes originais consta nos próprios conteúdos e links. Os textos editoriais incluídos são próprios; não são republicação integral das fontes.

Os únicos assets incluídos são placeholders geométricos criados para este snapshot, sem imagens ou vídeos obtidos de serviços externos. Os placeholders próprios acompanham a licença proprietária do projeto.
