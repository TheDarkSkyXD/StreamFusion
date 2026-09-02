import type { TranslationShape } from "../schema";
import type { coreEn } from "../en/core";

export const coreEs = {
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
