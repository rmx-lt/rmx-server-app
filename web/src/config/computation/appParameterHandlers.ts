export const APP_PARAMETER_HANDLER = {
    ENVIRONMENT_FORMAT: "env.format",
    ENVIRONMENT_TYPE: "env.type",
    ENVIRONMENT_COORDSYSTEM: "env.coordsystem",
} as const;

export type SupportedAppParameterHandler = (typeof APP_PARAMETER_HANDLER)[keyof typeof APP_PARAMETER_HANDLER];

const SUPPORTED_APP_PARAMETER_HANDLER_SET = new Set<string>(Object.values(APP_PARAMETER_HANDLER));

export function isSupportedAppParameterHandler(value: string): value is SupportedAppParameterHandler {
    return SUPPORTED_APP_PARAMETER_HANDLER_SET.has(value);
}