import type { FollowRepository } from "../capabilities/follow-repository";
import { getDesktopFollowRepository } from "../adapters/electron/follow-repository";

export const getFollowRepository: () => FollowRepository = getDesktopFollowRepository;
