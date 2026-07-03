-- Engagement signals for personalized reel recommendations.

CREATE TABLE IF NOT EXISTS public.reel_engagement_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reel_id uuid NOT NULL REFERENCES public.reels(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (
    event_type IN (
      'view', 'skip', 'pause', 'completion', 'rewatch',
      'like', 'save', 'share', 'comment', 'follow', 'not_interested'
    )
  ),
  completion_rate real,
  watch_ms int,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reel_engagement_profile_created
  ON public.reel_engagement_events(profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reel_engagement_reel_type
  ON public.reel_engagement_events(reel_id, event_type);

CREATE TABLE IF NOT EXISTS public.reel_not_interested (
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reel_id uuid NOT NULL REFERENCES public.reels(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, reel_id)
);

CREATE TABLE IF NOT EXISTS public.reel_saves (
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reel_id uuid NOT NULL REFERENCES public.reels(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, reel_id)
);

CREATE INDEX IF NOT EXISTS idx_reel_saves_profile ON public.reel_saves(profile_id, created_at DESC);

ALTER TABLE public.reel_engagement_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reel_not_interested ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reel_saves ENABLE ROW LEVEL SECURITY;
