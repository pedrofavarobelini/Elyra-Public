# Fixture de QA/demo da Rede de Apoio (SUP-1)

**Dados fictícios.** Nenhuma linha representa um estabelecimento real: nomes
começam com `[DEMO]`, os códigos CNES são inventados (faixa `99000xx`) e os
telefones usam `0000`. Só os códigos IBGE de município (355030 São Paulo,
330455 Rio de Janeiro) são reais, porque são geografia, não estabelecimento.

O cabeçalho é da própria Elyra (`qa-fixture-mapping.json`), **não** o
cabeçalho oficial do CNES. A importação real exige o mapeamento do arquivo
oficial fornecido pelo owner e a licença verificada (ADR-0031).

Casos cobertos: UBS, CAPS, pronto atendimento, tipo sem mapeamento, sem
coordenada, sem telefone, coordenada impossível (0,0), unidade desativada,
outra UF, CNES inválido e UF incoerente com o município (os dois últimos
rejeitados).
