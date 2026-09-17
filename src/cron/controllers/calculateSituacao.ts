export const calculateSituacao = (
  nivel_atual: number,
  nivel_pre_alerta: number,
  nivel_alerta: number,
  nivel_inundacao: number
): string => {
    switch (true) {
        case nivel_atual >= nivel_inundacao:
            return 'Inundação';

        case nivel_atual >= nivel_alerta:
            return 'Alerta';

        case nivel_atual >= nivel_pre_alerta:
            return 'Pré-alerta';

        default:
            return 'Normal';
    };
};
