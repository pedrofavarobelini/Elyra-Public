# Agenda e sessões

A disponibilidade é publicada para datas finitas, com horários e modalidade. A visão semanal permite navegar por dias e ajustar o que será oferecido. Alterações de disponibilidade não reescrevem automaticamente agendamentos existentes.

Criar ou cancelar agendamento passa por validação de participantes, autorização, antecedência e conflitos. O banco conserva regras de integridade para que uma corrida entre pedidos não produza reserva silenciosamente inconsistente. A interface distingue disponibilidade de compromisso confirmado.

Sessões têm fluxo próprio de preparação, participação e registro. Chamadas remotas exigem serviço LiveKit configurado; sua ausência deve produzir indisponibilidade. O setup local não pressupõe sala, token ou provedor de mídia hospedado.

Testes de integração de agenda e sessões exigem banco isolado e fixtures sintéticas. Testes unitários de contratos e regras podem rodar sem essa infraestrutura.
