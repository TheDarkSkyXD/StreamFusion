import type { TranslationShape } from "../schema";
import type { coreEn } from "../en/core";

export const coreEs = {
  common: {
    copyError: "Copiar error",
    errorCopied: "Error copiado",
    copyErrorFailed: "No se pudo copiar el error",
    following: "Siguiendo a {{channel}}",
    unfollowed: "Dejaste de seguir a {{channel}}",
    addedToFollows: "Se añadió a tus canales seguidos de {{platform}}.",
    removedFromFollows: "Se eliminó de tus canales seguidos de {{platform}}.",
    reconnectKickToContinue: "Vuelve a conectar Kick para continuar",
    kickFollowAuthExpired:
      "La autenticación de Kick caducó antes de confirmar el seguimiento. No se modificó tu lista.",
    kickUnfollowAuthExpired:
      "La autenticación de Kick caducó antes de confirmar que dejaste de seguir el canal. No se modificó tu lista.",
    followUpdateFailed: "No se pudo actualizar el seguimiento",
    kickFollowUpdateFailed:
      "Kick no pudo confirmar el seguimiento. No se modificó tu lista. Inténtalo de nuevo.",
    kickUnfollowUpdateFailed:
      "Kick no pudo confirmar que dejaste de seguir el canal. No se modificó tu lista. Inténtalo de nuevo.",
    twitchSessionExpired: "Tu sesión de Twitch caducó. Vuelve a conectar tu cuenta.",
    kickAuthorizationExpired: "Tu autorización de Kick caducó. Vuelve a conectar tu cuenta.",
    authInitializationFailed: "No se pudo iniciar la autenticación",
    twitchConnectionFailed: "No se pudo conectar con Twitch. Inténtalo de nuevo.",
    kickConnectionFailed: "No se pudo conectar con Kick. Inténtalo de nuevo.",
    connectionInterrupted: "La conexión se interrumpió. Inténtalo de nuevo.",
    tooManyLoginAttempts:
      "Demasiados intentos de inicio de sesión. Espera un momento e inténtalo de nuevo.",
    networkError: "Error de red. Comprueba tu conexión e inténtalo de nuevo.",
    twitchAuthNotConfigured:
      "La autenticación de Twitch no está configurada. Comprueba el archivo .env.",
    kickAuthNotConfigured:
      "La autenticación de Kick no está configurada. Comprueba el archivo .env.",
    loginTimedOut: "El inicio de sesión agotó el tiempo de espera. Inténtalo de nuevo.",
    twitchLogoutFailed: "No se pudo cerrar la sesión de Twitch",
    kickLogoutFailed: "No se pudo cerrar la sesión de Kick",
    playbackRecoveryExhausted:
      "La reproducción se detuvo después de dos intentos automáticos de recuperación",
  },
  navigation: {
    home: "Inicio",
    following: "Siguiendo",
    categories: "Categorías",
    multiview: "Multivista",
    history: "Historial",
    downloads: "Descargas",
    settings: "Configuración",
  },
  home: {
    failed: "No se pudieron cargar las transmisiones",
    retry: "Reintentar",
    browseCategories: "Explorar todas las categorías",
    liveChannels: "Canales en directo",
    providersUnavailable:
      "Los canales en directo de {{providers}} no están disponibles temporalmente.",
    loading: "Cargando...",
    retryLoading: "Reintentar la carga de canales en directo",
    loadMore: "Cargar más canales en directo",
    watch: "Ver a {{channel}}",
    watchNow: "Ver ahora",
    mutePreview: "Silenciar vista previa",
    unmutePreview: "Activar sonido de vista previa",
    showChannel: "Mostrar a {{channel}}",
    previousFeatured: "Transmisión destacada anterior",
    nextFeatured: "Siguiente transmisión destacada",
  },
  profile: {
    open: "Abrir menú de perfil",
    guest: "Invitado",
    guestPrompt: "Conecta una cuenta para tener acceso completo",
    connectedAccounts: "Cuentas conectadas",
    connectTwitch: "Conectar Twitch",
    connectKick: "Conectar Kick",
    twitchChannel: "Canal de Twitch",
    kickChannel: "Canal de Kick",
    channel: "Canal",
    settings: "Configuración",
    logout: "Cerrar sesión",
    displayLanguage: "Idioma de visualización",
    disconnectTwitch: "Desconectar Twitch",
    disconnectKick: "Desconectar Kick",
  },
  streamGrid: {
    empty: "No se encontraron transmisiones",
  },
} satisfies TranslationShape<typeof coreEn>;
