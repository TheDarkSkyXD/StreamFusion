export interface KickPredictionOutcomePayload {
  id: string;
  title: string;
  total_vote_amount: number;
  user_count?: number;
}

export interface KickPredictionUserVote {
  outcome_id: string;
  total_vote_amount: number;
}

export interface KickPredictionPayload {
  id: string;
  title: string;
  state: string;
  outcomes: KickPredictionOutcomePayload[];
  winning_outcome_id?: string | null;
  duration: number;
  created_at: string;
  user_vote?: KickPredictionUserVote;
}

export interface KickPredictionEventPayload {
  prediction: KickPredictionPayload;
}
