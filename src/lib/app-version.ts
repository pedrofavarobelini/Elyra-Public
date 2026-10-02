import packageJson from "../../package.json";

/**
 * Fonte unica da versao executavel.
 *
 * A Elyra continua pre-release academica: `0.2.x` identifica a geracao V2 e o
 * patch cresce para correcoes. Uma release publica estavel exigira decisao
 * explicita antes de `1.0.0`.
 */
export const APP_VERSION = packageJson.version;
