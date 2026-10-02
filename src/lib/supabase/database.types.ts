export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      account_deletions: {
        Row: {
          attempts: number
          domain_cleared_at: string | null
          failure_code: string | null
          id: string
          learning_exports_revoked: number
          learning_revoked_at: string | null
          requested_at: string
          status: string
          storage_cleared_at: string | null
          storage_objects_removed: number
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          domain_cleared_at?: string | null
          failure_code?: string | null
          id?: string
          learning_exports_revoked?: number
          learning_revoked_at?: string | null
          requested_at?: string
          status?: string
          storage_cleared_at?: string | null
          storage_objects_removed?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          domain_cleared_at?: string | null
          failure_code?: string | null
          id?: string
          learning_exports_revoked?: number
          learning_revoked_at?: string | null
          requested_at?: string
          status?: string
          storage_cleared_at?: string | null
          storage_objects_removed?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_insights: {
        Row: {
          contract_version: string
          correlation_id: string
          created_at: string
          fallback_used: boolean
          id: string
          idempotency_key_fingerprint: string
          model: string
          operation: string
          output: Json
          output_schema_version: string
          provider_used: string
          report_snapshot_id: string
          request_fingerprint: string
          user_id: string
        }
        Insert: {
          contract_version?: string
          correlation_id: string
          created_at?: string
          fallback_used?: boolean
          id?: string
          idempotency_key_fingerprint: string
          model: string
          operation?: string
          output: Json
          output_schema_version?: string
          provider_used: string
          report_snapshot_id: string
          request_fingerprint: string
          user_id: string
        }
        Update: {
          contract_version?: string
          correlation_id?: string
          created_at?: string
          fallback_used?: boolean
          id?: string
          idempotency_key_fingerprint?: string
          model?: string
          operation?: string
          output?: Json
          output_schema_version?: string
          provider_used?: string
          report_snapshot_id?: string
          request_fingerprint?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_insights_snapshot_owner_fkey"
            columns: ["report_snapshot_id", "user_id"]
            isOneToOne: false
            referencedRelation: "report_snapshots"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      app_lock_sessions: {
        Row: {
          cooldown_until: string | null
          created_at: string
          failed_attempts: number
          idle_policy: string
          kdf_version: number
          last_activity_at: string | null
          lock_id: string
          pin_salt: string
          pin_verifier: string
          scrypt_n: number
          scrypt_p: number
          scrypt_r: number
          session_id: string
          state: string
          unlocked_until: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cooldown_until?: string | null
          created_at?: string
          failed_attempts?: number
          idle_policy?: string
          kdf_version?: number
          last_activity_at?: string | null
          lock_id: string
          pin_salt: string
          pin_verifier: string
          scrypt_n?: number
          scrypt_p?: number
          scrypt_r?: number
          session_id: string
          state: string
          unlocked_until?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cooldown_until?: string | null
          created_at?: string
          failed_attempts?: number
          idle_policy?: string
          kdf_version?: number
          last_activity_at?: string | null
          lock_id?: string
          pin_salt?: string
          pin_verifier?: string
          scrypt_n?: number
          scrypt_p?: number
          scrypt_r?: number
          session_id?: string
          state?: string
          unlocked_until?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_lock_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      appointments: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          client_user_id: string
          completed_at: string | null
          confirmed_at: string | null
          connection_id: string
          created_at: string
          ends_at: string
          id: string
          idempotency_key: string
          modality: string
          no_show_at: string | null
          professional_user_id: string
          requested_at: string
          requested_by: string
          starts_at: string
          status: string
          timezone: string
          updated_at: string
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          client_user_id: string
          completed_at?: string | null
          confirmed_at?: string | null
          connection_id: string
          created_at?: string
          ends_at: string
          id?: string
          idempotency_key: string
          modality: string
          no_show_at?: string | null
          professional_user_id: string
          requested_at?: string
          requested_by: string
          starts_at: string
          status?: string
          timezone: string
          updated_at?: string
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          client_user_id?: string
          completed_at?: string | null
          confirmed_at?: string | null
          connection_id?: string
          created_at?: string
          ends_at?: string
          id?: string
          idempotency_key?: string
          modality?: string
          no_show_at?: string | null
          professional_user_id?: string
          requested_at?: string
          requested_by?: string
          starts_at?: string
          status?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "appointments_client_user_id_fkey"
            columns: ["client_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "appointments_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "professional_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_professional_user_id_fkey"
            columns: ["professional_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "appointments_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_user_id: string | null
          correlation_id: string
          entity_id: string | null
          entity_type: string
          id: string
          occurred_at: string
          outcome: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          correlation_id?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          occurred_at?: string
          outcome: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          correlation_id?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          occurred_at?: string
          outcome?: string
        }
        Relationships: []
      }
      consent_events: {
        Row: {
          document_version: string
          event_type: string
          expires_at: string | null
          granted_event_id: string | null
          id: string
          occurred_at: string
          purpose: string
          user_id: string
        }
        Insert: {
          document_version: string
          event_type: string
          expires_at?: string | null
          granted_event_id?: string | null
          id?: string
          occurred_at?: string
          purpose: string
          user_id: string
        }
        Update: {
          document_version?: string
          event_type?: string
          expires_at?: string | null
          granted_event_id?: string | null
          id?: string
          occurred_at?: string
          purpose?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "consent_events_granted_event_id_fkey"
            columns: ["granted_event_id"]
            isOneToOne: false
            referencedRelation: "consent_events"
            referencedColumns: ["id"]
          },
        ]
      }
      cycle_daily_records: {
        Row: {
          created_at: string
          flow: string | null
          id: string
          note: string | null
          record_date: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          flow?: string | null
          id?: string
          note?: string | null
          record_date: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          flow?: string | null
          id?: string
          note?: string | null
          record_date?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cycle_daily_records_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "cycle_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      cycle_daily_symptoms: {
        Row: {
          record_id: string
          severity: string
          symptom_id: string
        }
        Insert: {
          record_id: string
          severity: string
          symptom_id: string
        }
        Update: {
          record_id?: string
          severity?: string
          symptom_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cycle_daily_symptoms_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "cycle_daily_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cycle_daily_symptoms_symptom_id_fkey"
            columns: ["symptom_id"]
            isOneToOne: false
            referencedRelation: "cycle_symptoms"
            referencedColumns: ["id"]
          },
        ]
      }
      cycle_periods: {
        Row: {
          created_at: string
          end_date: string | null
          id: string
          start_date: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          end_date?: string | null
          id?: string
          start_date: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          end_date?: string | null
          id?: string
          start_date?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cycle_periods_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "cycle_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      cycle_profiles: {
        Row: {
          enabled: boolean
          opted_in_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          enabled?: boolean
          opted_in_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          enabled?: boolean
          opted_in_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cycle_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      cycle_symptoms: {
        Row: {
          created_at: string
          id: string
          label: string
          origin: string
          owner_user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          origin: string
          owner_user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          origin?: string
          owner_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cycle_symptoms_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      deletion_ledger: {
        Row: {
          correlation_id: string
          deleted_at: string
          id: string
          origin: string
          subject_user_id: string
        }
        Insert: {
          correlation_id?: string
          deleted_at?: string
          id?: string
          origin?: string
          subject_user_id: string
        }
        Update: {
          correlation_id?: string
          deleted_at?: string
          id?: string
          origin?: string
          subject_user_id?: string
        }
        Relationships: []
      }
      derived_features: {
        Row: {
          coverage_ms: number | null
          coverage_outcome: string | null
          created_at: string
          delta_vs_personal_baseline: number | null
          extractor_version: string
          id: string
          personal_baseline_mean: number | null
          personal_baseline_samples: number
          session_id: string
          signal_name: string
          status: string
          unit: string
          updated_at: string
          user_id: string
          value: number | null
        }
        Insert: {
          coverage_ms?: number | null
          coverage_outcome?: string | null
          created_at?: string
          delta_vs_personal_baseline?: number | null
          extractor_version?: string
          id?: string
          personal_baseline_mean?: number | null
          personal_baseline_samples?: number
          session_id: string
          signal_name: string
          status: string
          unit: string
          updated_at?: string
          user_id: string
          value?: number | null
        }
        Update: {
          coverage_ms?: number | null
          coverage_outcome?: string | null
          created_at?: string
          delta_vs_personal_baseline?: number | null
          extractor_version?: string
          id?: string
          personal_baseline_mean?: number | null
          personal_baseline_samples?: number
          session_id?: string
          signal_name?: string
          status?: string
          unit?: string
          updated_at?: string
          user_id?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "derived_features_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "multimodal_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "derived_features_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      education_registry_courses: {
        Row: {
          course_code: number
          course_name_normalized: string
          course_status: string | null
          degree: string | null
          institution_code: number
          institution_name_normalized: string
          snapshot_id: string
        }
        Insert: {
          course_code: number
          course_name_normalized: string
          course_status?: string | null
          degree?: string | null
          institution_code: number
          institution_name_normalized: string
          snapshot_id: string
        }
        Update: {
          course_code?: number
          course_name_normalized?: string
          course_status?: string | null
          degree?: string | null
          institution_code?: number
          institution_name_normalized?: string
          snapshot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "education_registry_courses_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "education_registry_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      education_registry_snapshots: {
        Row: {
          active: boolean
          file_sha256: string
          id: string
          imported_at: string
          reference_date: string
          row_count: number
          source: string
        }
        Insert: {
          active?: boolean
          file_sha256: string
          id?: string
          imported_at?: string
          reference_date: string
          row_count: number
          source: string
        }
        Update: {
          active?: boolean
          file_sha256?: string
          id?: string
          imported_at?: string
          reference_date?: string
          row_count?: number
          source?: string
        }
        Relationships: []
      }
      email_deliveries: {
        Row: {
          attempts: number
          body: string
          created_at: string
          delivered_at: string | null
          event_key: string
          failure_code: string | null
          id: string
          kind: string
          status: string
          subject: string
          transport: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          body: string
          created_at?: string
          delivered_at?: string | null
          event_key: string
          failure_code?: string | null
          id?: string
          kind: string
          status?: string
          subject: string
          transport: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          body?: string
          created_at?: string
          delivered_at?: string | null
          event_key?: string
          failure_code?: string | null
          id?: string
          kind?: string
          status?: string
          subject?: string
          transport?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_deliveries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      emotional_checkin_factors: {
        Row: {
          checkin_id: string
          factor_id: string
        }
        Insert: {
          checkin_id: string
          factor_id: string
        }
        Update: {
          checkin_id?: string
          factor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "emotional_checkin_factors_checkin_id_fkey"
            columns: ["checkin_id"]
            isOneToOne: false
            referencedRelation: "emotional_checkins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emotional_checkin_factors_factor_id_fkey"
            columns: ["factor_id"]
            isOneToOne: false
            referencedRelation: "emotional_factors"
            referencedColumns: ["id"]
          },
        ]
      }
      emotional_checkins: {
        Row: {
          created_at: string
          energy_score: number | null
          id: string
          mood_score: number | null
          note: string | null
          occurred_at: string
          perceived_anxiety_score: number | null
          primary_feeling: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          energy_score?: number | null
          id?: string
          mood_score?: number | null
          note?: string | null
          occurred_at?: string
          perceived_anxiety_score?: number | null
          primary_feeling?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          energy_score?: number | null
          id?: string
          mood_score?: number | null
          note?: string | null
          occurred_at?: string
          perceived_anxiety_score?: number | null
          primary_feeling?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "emotional_checkins_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      emotional_factors: {
        Row: {
          created_at: string
          id: string
          label: string
          origin: string
          owner_user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          origin: string
          owner_user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          origin?: string
          owner_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "emotional_factors_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      goal_progress_entries: {
        Row: {
          amount: number
          created_at: string
          goal_id: string
          id: string
          occurred_on: string
        }
        Insert: {
          amount: number
          created_at?: string
          goal_id: string
          id?: string
          occurred_on?: string
        }
        Update: {
          amount?: number
          created_at?: string
          goal_id?: string
          id?: string
          occurred_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "goal_progress_entries_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
        ]
      }
      goals: {
        Row: {
          created_at: string
          id: string
          kind: string
          recurrence: string
          status: string
          target: number
          title: string
          unit: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          recurrence: string
          status?: string
          target: number
          title: string
          unit?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          recurrence?: string
          status?: string
          target?: number
          title?: string
          unit?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      help_requests: {
        Row: {
          body: string | null
          body_purged_at: string | null
          client_user_id: string
          connection_id: string
          created_at: string
          ended_at: string | null
          ended_by: string | null
          expires_at: string
          id: string
          idempotency_key: string
          professional_user_id: string
          responded_at: string | null
          seen_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          body?: string | null
          body_purged_at?: string | null
          client_user_id: string
          connection_id: string
          created_at?: string
          ended_at?: string | null
          ended_by?: string | null
          expires_at: string
          id?: string
          idempotency_key: string
          professional_user_id: string
          responded_at?: string | null
          seen_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          body?: string | null
          body_purged_at?: string | null
          client_user_id?: string
          connection_id?: string
          created_at?: string
          ended_at?: string | null
          ended_by?: string | null
          expires_at?: string
          id?: string
          idempotency_key?: string
          professional_user_id?: string
          responded_at?: string | null
          seen_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "help_requests_client_user_id_fkey"
            columns: ["client_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "help_requests_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "professional_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "help_requests_ended_by_fkey"
            columns: ["ended_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "help_requests_professional_user_id_fkey"
            columns: ["professional_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      journal_entries: {
        Row: {
          content: string
          created_at: string
          id: string
          status: string
          title: string
          trashed_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          content?: string
          created_at?: string
          id?: string
          status?: string
          title?: string
          trashed_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          status?: string
          title?: string
          trashed_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "journal_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      journal_entry_tags: {
        Row: {
          entry_id: string
          tag_id: string
        }
        Insert: {
          entry_id: string
          tag_id: string
        }
        Update: {
          entry_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "journal_entry_tags_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entry_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "journal_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_tags: {
        Row: {
          created_at: string
          id: string
          label: string
          origin: string
          owner_user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          origin: string
          owner_user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          origin?: string
          owner_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_tags_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      learning_exports: {
        Row: {
          analytics_version: string
          candidate_id: string | null
          candidate_lifecycle: string | null
          contract_version: string
          correlation_id: string
          created_at: string
          export_schema_version: string
          exported_at: string | null
          fingerprint: string
          id: string
          policy_version: string
          produced_at: string
          quality_passed: boolean
          rejection_code: string | null
          report_snapshot_id: string
          revocation_reason: string | null
          revoked_at: string | null
          source_schema_version: string
          status: string
          training_consent_event_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          analytics_version?: string
          candidate_id?: string | null
          candidate_lifecycle?: string | null
          contract_version?: string
          correlation_id: string
          created_at?: string
          export_schema_version?: string
          exported_at?: string | null
          fingerprint: string
          id?: string
          policy_version?: string
          produced_at: string
          quality_passed: boolean
          rejection_code?: string | null
          report_snapshot_id: string
          revocation_reason?: string | null
          revoked_at?: string | null
          source_schema_version?: string
          status: string
          training_consent_event_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          analytics_version?: string
          candidate_id?: string | null
          candidate_lifecycle?: string | null
          contract_version?: string
          correlation_id?: string
          created_at?: string
          export_schema_version?: string
          exported_at?: string | null
          fingerprint?: string
          id?: string
          policy_version?: string
          produced_at?: string
          quality_passed?: boolean
          rejection_code?: string | null
          report_snapshot_id?: string
          revocation_reason?: string | null
          revoked_at?: string | null
          source_schema_version?: string
          status?: string
          training_consent_event_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "learning_export_snapshot_belongs_to_owner"
            columns: ["report_snapshot_id", "user_id"]
            isOneToOne: false
            referencedRelation: "report_snapshots"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "learning_exports_training_consent_event_id_fkey"
            columns: ["training_consent_event_id"]
            isOneToOne: false
            referencedRelation: "consent_events"
            referencedColumns: ["id"]
          },
        ]
      }
      media_assets: {
        Row: {
          checksum_sha256: string
          created_at: string
          deleted_at: string | null
          duration_ms: number | null
          id: string
          media_kind: string
          mime_type: string
          retention_until: string
          session_id: string
          size_bytes: number
          status: string
          storage_path: string
          updated_at: string
          user_id: string
        }
        Insert: {
          checksum_sha256: string
          created_at?: string
          deleted_at?: string | null
          duration_ms?: number | null
          id?: string
          media_kind: string
          mime_type: string
          retention_until?: string
          session_id: string
          size_bytes: number
          status?: string
          storage_path: string
          updated_at?: string
          user_id: string
        }
        Update: {
          checksum_sha256?: string
          created_at?: string
          deleted_at?: string | null
          duration_ms?: number | null
          id?: string
          media_kind?: string
          mime_type?: string
          retention_until?: string
          session_id?: string
          size_bytes?: number
          status?: string
          storage_path?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_assets_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "multimodal_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_assets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      multimodal_sessions: {
        Row: {
          ai_analysis_consent: boolean
          camera_consent: boolean
          created_at: string
          ended_at: string | null
          id: string
          kind: string
          microphone_consent: boolean
          professional_session_id: string | null
          screen_consent: boolean
          share_original_consent: boolean
          share_result_consent: boolean
          share_transcript_consent: boolean
          started_at: string
          status: string
          storage_consent: boolean
          training_eligibility_consent: boolean
          transcription_consent: boolean
          updated_at: string
          user_id: string
          visual_analysis_consent: boolean
        }
        Insert: {
          ai_analysis_consent?: boolean
          camera_consent?: boolean
          created_at?: string
          ended_at?: string | null
          id?: string
          kind: string
          microphone_consent?: boolean
          professional_session_id?: string | null
          screen_consent?: boolean
          share_original_consent?: boolean
          share_result_consent?: boolean
          share_transcript_consent?: boolean
          started_at?: string
          status?: string
          storage_consent?: boolean
          training_eligibility_consent?: boolean
          transcription_consent?: boolean
          updated_at?: string
          user_id: string
          visual_analysis_consent?: boolean
        }
        Update: {
          ai_analysis_consent?: boolean
          camera_consent?: boolean
          created_at?: string
          ended_at?: string | null
          id?: string
          kind?: string
          microphone_consent?: boolean
          professional_session_id?: string | null
          screen_consent?: boolean
          share_original_consent?: boolean
          share_result_consent?: boolean
          share_transcript_consent?: boolean
          started_at?: string
          status?: string
          storage_consent?: boolean
          training_eligibility_consent?: boolean
          transcription_consent?: boolean
          updated_at?: string
          user_id?: string
          visual_analysis_consent?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "multimodal_sessions_professional_session_id_fkey"
            columns: ["professional_session_id"]
            isOneToOne: false
            referencedRelation: "professional_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "multimodal_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      notification_dispatch_runs: {
        Row: {
          delivered: number
          failed: number
          finished_at: string | null
          id: string
          outcome: string
          selected: number
          started_at: string
          suppressed: number
          transport: string
        }
        Insert: {
          delivered?: number
          failed?: number
          finished_at?: string | null
          id?: string
          outcome?: string
          selected?: number
          started_at?: string
          suppressed?: number
          transport: string
        }
        Update: {
          delivered?: number
          failed?: number
          finished_at?: string | null
          id?: string
          outcome?: string
          selected?: number
          started_at?: string
          suppressed?: number
          transport?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          channel: string
          created_at: string
          enabled: boolean
          kind: string
          snoozed_until: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          channel: string
          created_at?: string
          enabled?: boolean
          kind: string
          snoozed_until?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          enabled?: boolean
          kind?: string
          snoozed_until?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          event_key: string
          id: string
          kind: string
          read_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          event_key: string
          id?: string
          kind: string
          read_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          event_key?: string
          id?: string
          kind?: string
          read_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      pending_consents: {
        Row: {
          consent_event_id: string | null
          consumed_at: string | null
          created_at: string
          document_version: string
          purpose: string
          user_id: string
        }
        Insert: {
          consent_event_id?: string | null
          consumed_at?: string | null
          created_at?: string
          document_version: string
          purpose: string
          user_id: string
        }
        Update: {
          consent_event_id?: string | null
          consumed_at?: string | null
          created_at?: string
          document_version?: string
          purpose?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_consents_consent_event_id_fkey"
            columns: ["consent_event_id"]
            isOneToOne: false
            referencedRelation: "consent_events"
            referencedColumns: ["id"]
          },
        ]
      }
      processing_jobs: {
        Row: {
          attempts: number
          created_at: string
          error_code: string | null
          finished_at: string | null
          id: string
          job_kind: string
          media_asset_id: string | null
          session_id: string
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          error_code?: string | null
          finished_at?: string | null
          id?: string
          job_kind: string
          media_asset_id?: string | null
          session_id: string
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          error_code?: string | null
          finished_at?: string | null
          id?: string
          job_kind?: string
          media_asset_id?: string | null
          session_id?: string
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "processing_jobs_media_asset_id_fkey"
            columns: ["media_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "processing_jobs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "multimodal_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "processing_jobs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      professional_access_log: {
        Row: {
          actor_role: string
          client_user_id: string
          connection_id: string
          correlation_id: string
          event_type: string
          id: string
          occurred_at: string
          outcome: string
          policy_version: string
          professional_user_id: string
          scope: string | null
        }
        Insert: {
          actor_role?: string
          client_user_id: string
          connection_id: string
          correlation_id?: string
          event_type?: string
          id?: string
          occurred_at?: string
          outcome?: string
          policy_version?: string
          professional_user_id: string
          scope?: string | null
        }
        Update: {
          actor_role?: string
          client_user_id?: string
          connection_id?: string
          correlation_id?: string
          event_type?: string
          id?: string
          occurred_at?: string
          outcome?: string
          policy_version?: string
          professional_user_id?: string
          scope?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "professional_access_log_client_user_id_fkey"
            columns: ["client_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "professional_access_log_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "professional_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professional_access_log_professional_user_id_fkey"
            columns: ["professional_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      professional_availability_exceptions: {
        Row: {
          created_at: string
          end_minute: number | null
          ends_on: string
          id: string
          kind: string
          modality: string | null
          professional_user_id: string
          slot_minutes: number | null
          start_minute: number | null
          starts_on: string
          timezone: string
        }
        Insert: {
          created_at?: string
          end_minute?: number | null
          ends_on: string
          id?: string
          kind: string
          modality?: string | null
          professional_user_id: string
          slot_minutes?: number | null
          start_minute?: number | null
          starts_on: string
          timezone: string
        }
        Update: {
          created_at?: string
          end_minute?: number | null
          ends_on?: string
          id?: string
          kind?: string
          modality?: string | null
          professional_user_id?: string
          slot_minutes?: number | null
          start_minute?: number | null
          starts_on?: string
          timezone?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_availability_exceptions_professional_user_id_fkey"
            columns: ["professional_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      professional_availability_rules: {
        Row: {
          created_at: string
          end_minute: number
          id: string
          modality: string
          professional_user_id: string
          slot_minutes: number
          start_minute: number
          timezone: string
          updated_at: string
          weekday: number
        }
        Insert: {
          created_at?: string
          end_minute: number
          id?: string
          modality: string
          professional_user_id: string
          slot_minutes: number
          start_minute: number
          timezone: string
          updated_at?: string
          weekday: number
        }
        Update: {
          created_at?: string
          end_minute?: number
          id?: string
          modality?: string
          professional_user_id?: string
          slot_minutes?: number
          start_minute?: number
          timezone?: string
          updated_at?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "professional_availability_rules_professional_user_id_fkey"
            columns: ["professional_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      professional_availability_weeks: {
        Row: {
          professional_user_id: string
          published_at: string
          timezone: string
          week_start: string
        }
        Insert: {
          professional_user_id: string
          published_at?: string
          timezone: string
          week_start: string
        }
        Update: {
          professional_user_id?: string
          published_at?: string
          timezone?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_availability_weeks_professional_user_id_fkey"
            columns: ["professional_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      professional_connections: {
        Row: {
          accepted_at: string | null
          client_user_id: string
          ended_at: string | null
          ended_by_user_id: string | null
          id: string
          invited_at: string
          invited_by_user_id: string
          origin_invite_id: string | null
          paused_at: string | null
          professional_user_id: string
          revoked_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          client_user_id: string
          ended_at?: string | null
          ended_by_user_id?: string | null
          id?: string
          invited_at?: string
          invited_by_user_id: string
          origin_invite_id?: string | null
          paused_at?: string | null
          professional_user_id: string
          revoked_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          client_user_id?: string
          ended_at?: string | null
          ended_by_user_id?: string | null
          id?: string
          invited_at?: string
          invited_by_user_id?: string
          origin_invite_id?: string | null
          paused_at?: string | null
          professional_user_id?: string
          revoked_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_connections_client_user_id_fkey"
            columns: ["client_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "professional_connections_ended_by_user_id_fkey"
            columns: ["ended_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "professional_connections_invited_by_user_id_fkey"
            columns: ["invited_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "professional_connections_origin_invite_id_fkey"
            columns: ["origin_invite_id"]
            isOneToOne: false
            referencedRelation: "professional_invites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professional_connections_professional_user_id_fkey"
            columns: ["professional_user_id"]
            isOneToOne: false
            referencedRelation: "professional_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      professional_credentials: {
        Row: {
          created_at: string
          end_year: number | null
          evidence_digest: string | null
          expires_on: string | null
          id: string
          institution: string
          kind: string
          policy_version: string | null
          position: number
          start_year: number | null
          title: string
          trust_state: string
          updated_at: string
          user_id: string
          verification_source: string | null
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          end_year?: number | null
          evidence_digest?: string | null
          expires_on?: string | null
          id?: string
          institution: string
          kind: string
          policy_version?: string | null
          position?: number
          start_year?: number | null
          title: string
          trust_state?: string
          updated_at?: string
          user_id: string
          verification_source?: string | null
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          end_year?: number | null
          evidence_digest?: string | null
          expires_on?: string | null
          id?: string
          institution?: string
          kind?: string
          policy_version?: string | null
          position?: number
          start_year?: number | null
          title?: string
          trust_state?: string
          updated_at?: string
          user_id?: string
          verification_source?: string | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "professional_credentials_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      professional_directory_access: {
        Row: {
          id: number
          occurred_at: string
          user_id: string
        }
        Insert: {
          id?: never
          occurred_at?: string
          user_id: string
        }
        Update: {
          id?: never
          occurred_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_directory_access_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      professional_invites: {
        Row: {
          accepted_at: string | null
          consumed_at: string | null
          created_at: string
          expired_at: string | null
          expires_at: string
          id: string
          opened_at: string | null
          policy_version: string
          professional_user_id: string
          redeemed_by_user_id: string | null
          relationship_id: string | null
          revoked_at: string | null
          state: string
          token_digest: string
        }
        Insert: {
          accepted_at?: string | null
          consumed_at?: string | null
          created_at?: string
          expired_at?: string | null
          expires_at: string
          id?: string
          opened_at?: string | null
          policy_version?: string
          professional_user_id: string
          redeemed_by_user_id?: string | null
          relationship_id?: string | null
          revoked_at?: string | null
          state?: string
          token_digest: string
        }
        Update: {
          accepted_at?: string | null
          consumed_at?: string | null
          created_at?: string
          expired_at?: string | null
          expires_at?: string
          id?: string
          opened_at?: string | null
          policy_version?: string
          professional_user_id?: string
          redeemed_by_user_id?: string | null
          relationship_id?: string | null
          revoked_at?: string | null
          state?: string
          token_digest?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_invites_professional_user_id_fkey"
            columns: ["professional_user_id"]
            isOneToOne: false
            referencedRelation: "professional_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "professional_invites_redeemed_by_user_id_fkey"
            columns: ["redeemed_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "professional_invites_relationship_id_fkey"
            columns: ["relationship_id"]
            isOneToOne: false
            referencedRelation: "professional_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      professional_notes: {
        Row: {
          body: string
          client_user_id: string
          connection_id: string
          created_at: string
          id: string
          professional_user_id: string
          updated_at: string
        }
        Insert: {
          body: string
          client_user_id: string
          connection_id: string
          created_at?: string
          id?: string
          professional_user_id: string
          updated_at?: string
        }
        Update: {
          body?: string
          client_user_id?: string
          connection_id?: string
          created_at?: string
          id?: string
          professional_user_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_notes_connection_fkey"
            columns: ["connection_id", "client_user_id", "professional_user_id"]
            isOneToOne: false
            referencedRelation: "professional_connections"
            referencedColumns: ["id", "client_user_id", "professional_user_id"]
          },
        ]
      }
      professional_onboarding: {
        Row: {
          completed_steps: string[]
          created_at: string
          current_step: string
          draft_council_region: string | null
          draft_public_profile: Json
          draft_registration_number: string | null
          draft_specialty: string | null
          identity_confirmed_at: string | null
          precheck_submission: number
          submission_count: number
          submitted_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_steps?: string[]
          created_at?: string
          current_step?: string
          draft_council_region?: string | null
          draft_public_profile?: Json
          draft_registration_number?: string | null
          draft_specialty?: string | null
          identity_confirmed_at?: string | null
          precheck_submission?: number
          submission_count?: number
          submitted_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_steps?: string[]
          created_at?: string
          current_step?: string
          draft_council_region?: string | null
          draft_public_profile?: Json
          draft_registration_number?: string | null
          draft_specialty?: string | null
          identity_confirmed_at?: string | null
          precheck_submission?: number
          submission_count?: number
          submitted_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_onboarding_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      professional_profiles: {
        Row: {
          council: string
          council_region: string | null
          created_at: string
          registration_normalized: string | null
          registration_number: string
          specialty: string
          updated_at: string
          user_id: string
          verification_review_due_at: string | null
          verification_reviewed_at: string | null
          verification_status: string
          verification_updated_at: string
        }
        Insert: {
          council?: string
          council_region?: string | null
          created_at?: string
          registration_normalized?: string | null
          registration_number: string
          specialty: string
          updated_at?: string
          user_id: string
          verification_review_due_at?: string | null
          verification_reviewed_at?: string | null
          verification_status?: string
          verification_updated_at?: string
        }
        Update: {
          council?: string
          council_region?: string | null
          created_at?: string
          registration_normalized?: string | null
          registration_number?: string
          specialty?: string
          updated_at?: string
          user_id?: string
          verification_review_due_at?: string | null
          verification_reviewed_at?: string | null
          verification_status?: string
          verification_updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      professional_public_profiles: {
        Row: {
          areas: string[]
          bio: string | null
          city: string | null
          city_normalized: string | null
          created_at: string
          display_name: string | null
          languages: string[]
          listed: boolean
          modalities: string[]
          name_normalized: string | null
          search_normalized: string | null
          slug: string
          state: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          areas?: string[]
          bio?: string | null
          city?: string | null
          city_normalized?: string | null
          created_at?: string
          display_name?: string | null
          languages?: string[]
          listed?: boolean
          modalities?: string[]
          name_normalized?: string | null
          search_normalized?: string | null
          slug?: string
          state?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          areas?: string[]
          bio?: string | null
          city?: string | null
          city_normalized?: string | null
          created_at?: string
          display_name?: string | null
          languages?: string[]
          listed?: boolean
          modalities?: string[]
          name_normalized?: string | null
          search_normalized?: string | null
          slug?: string
          state?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_public_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "professional_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      professional_reviewers: {
        Row: {
          active: boolean
          granted_at: string
          granted_by: string
          revoked_at: string | null
          user_id: string
        }
        Insert: {
          active?: boolean
          granted_at?: string
          granted_by: string
          revoked_at?: string | null
          user_id: string
        }
        Update: {
          active?: boolean
          granted_at?: string
          granted_by?: string
          revoked_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_reviewers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      professional_session_events: {
        Row: {
          actor_user_id: string | null
          connection_id: string
          correlation_id: string
          detail: string | null
          event: string
          id: string
          occurred_at: string
          policy_version: string
          result: string
          session_id: string
          subject_user_id: string
        }
        Insert: {
          actor_user_id?: string | null
          connection_id: string
          correlation_id?: string
          detail?: string | null
          event: string
          id?: string
          occurred_at?: string
          policy_version?: string
          result: string
          session_id: string
          subject_user_id: string
        }
        Update: {
          actor_user_id?: string | null
          connection_id?: string
          correlation_id?: string
          detail?: string | null
          event?: string
          id?: string
          occurred_at?: string
          policy_version?: string
          result?: string
          session_id?: string
          subject_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_session_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "professional_session_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "professional_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professional_session_events_subject_user_id_fkey"
            columns: ["subject_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      professional_sessions: {
        Row: {
          allow_ai_derivation: boolean
          allow_audio: boolean
          allow_professional_transcript_access: boolean
          allow_transcription: boolean
          allow_video: boolean
          appointment_id: string
          cancelled_at: string | null
          client_user_id: string
          closes_at: string
          completed_at: string | null
          connection_id: string
          created_at: string
          expired_at: string | null
          id: string
          media_generation: number
          opens_at: string
          professional_user_id: string
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          allow_ai_derivation?: boolean
          allow_audio?: boolean
          allow_professional_transcript_access?: boolean
          allow_transcription?: boolean
          allow_video?: boolean
          appointment_id: string
          cancelled_at?: string | null
          client_user_id: string
          closes_at: string
          completed_at?: string | null
          connection_id: string
          created_at?: string
          expired_at?: string | null
          id?: string
          media_generation?: number
          opens_at: string
          professional_user_id: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          allow_ai_derivation?: boolean
          allow_audio?: boolean
          allow_professional_transcript_access?: boolean
          allow_transcription?: boolean
          allow_video?: boolean
          appointment_id?: string
          cancelled_at?: string | null
          client_user_id?: string
          closes_at?: string
          completed_at?: string | null
          connection_id?: string
          created_at?: string
          expired_at?: string | null
          id?: string
          media_generation?: number
          opens_at?: string
          professional_user_id?: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_sessions_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: true
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professional_sessions_client_user_id_fkey"
            columns: ["client_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "professional_sessions_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "professional_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professional_sessions_professional_user_id_fkey"
            columns: ["professional_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      professional_verification_evidence: {
        Row: {
          assurance: string | null
          checked_at: string
          confidence: number | null
          created_at: string
          detail: string | null
          expires_at: string | null
          fact_type: string
          id: string
          policy_version: string
          professional_user_id: string
          provider: string
          raw_evidence_retained: boolean
          retention_until: string | null
          source_type: string
          status: string
          submission: number
          value_digest: string | null
        }
        Insert: {
          assurance?: string | null
          checked_at?: string
          confidence?: number | null
          created_at?: string
          detail?: string | null
          expires_at?: string | null
          fact_type: string
          id?: string
          policy_version: string
          professional_user_id: string
          provider: string
          raw_evidence_retained?: boolean
          retention_until?: string | null
          source_type: string
          status: string
          submission: number
          value_digest?: string | null
        }
        Update: {
          assurance?: string | null
          checked_at?: string
          confidence?: number | null
          created_at?: string
          detail?: string | null
          expires_at?: string | null
          fact_type?: string
          id?: string
          policy_version?: string
          professional_user_id?: string
          provider?: string
          raw_evidence_retained?: boolean
          retention_until?: string | null
          source_type?: string
          status?: string
          submission?: number
          value_digest?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "professional_verification_evidence_professional_user_id_fkey"
            columns: ["professional_user_id"]
            isOneToOne: false
            referencedRelation: "professional_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      professional_verification_settings: {
        Row: {
          accept_fixture_evidence: boolean
          singleton: boolean
          updated_at: string
        }
        Insert: {
          accept_fixture_evidence?: boolean
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          accept_fixture_evidence?: boolean
          singleton?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      professional_verifications: {
        Row: {
          actor_role: string
          actor_user_id: string | null
          correlation_id: string
          evidence_digest: string | null
          from_status: string | null
          id: string
          occurred_at: string
          policy_version: string
          professional_user_id: string
          reason_code: string
          review_due_at: string | null
          source: string
          to_status: string
        }
        Insert: {
          actor_role: string
          actor_user_id?: string | null
          correlation_id?: string
          evidence_digest?: string | null
          from_status?: string | null
          id?: string
          occurred_at?: string
          policy_version?: string
          professional_user_id: string
          reason_code: string
          review_due_at?: string | null
          source: string
          to_status: string
        }
        Update: {
          actor_role?: string
          actor_user_id?: string | null
          correlation_id?: string
          evidence_digest?: string | null
          from_status?: string | null
          id?: string
          occurred_at?: string
          policy_version?: string
          professional_user_id?: string
          reason_code?: string
          review_due_at?: string | null
          source?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_verifications_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "professional_verifications_professional_user_id_fkey"
            columns: ["professional_user_id"]
            isOneToOne: false
            referencedRelation: "professional_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_path: string | null
          created_at: string
          display_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_path?: string | null
          created_at?: string
          display_name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_path?: string | null
          created_at?: string
          display_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      report_snapshots: {
        Row: {
          analytics_version: string
          created_at: string
          cycle_heuristic_version: string
          id: string
          payload: Json
          period_end: string
          period_start: string
          range_days: number
          schema_version: string
          time_zone: string
          user_id: string
        }
        Insert: {
          analytics_version?: string
          created_at?: string
          cycle_heuristic_version?: string
          id?: string
          payload: Json
          period_end: string
          period_start: string
          range_days: number
          schema_version?: string
          time_zone: string
          user_id: string
        }
        Update: {
          analytics_version?: string
          created_at?: string
          cycle_heuristic_version?: string
          id?: string
          payload?: Json
          period_end?: string
          period_start?: string
          range_days?: number
          schema_version?: string
          time_zone?: string
          user_id?: string
        }
        Relationships: []
      }
      session_access_credentials: {
        Row: {
          expires_at: string
          id: string
          issued_at: string
          participant_user_id: string
          revoked_at: string | null
          session_id: string
          token_digest: string
          used_at: string | null
        }
        Insert: {
          expires_at: string
          id?: string
          issued_at?: string
          participant_user_id: string
          revoked_at?: string | null
          session_id: string
          token_digest: string
          used_at?: string | null
        }
        Update: {
          expires_at?: string
          id?: string
          issued_at?: string
          participant_user_id?: string
          revoked_at?: string | null
          session_id?: string
          token_digest?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "session_access_credentials_participant_user_id_fkey"
            columns: ["participant_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "session_access_credentials_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "professional_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_feedback: {
        Row: {
          created_at: string
          id: string
          rating: string
          reason: string | null
          session_id: string
          target_id: string | null
          target_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          rating: string
          reason?: string | null
          session_id: string
          target_id?: string | null
          target_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          rating?: string
          reason?: string | null
          session_id?: string
          target_id?: string | null
          target_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_feedback_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "multimodal_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      session_interpretations: {
        Row: {
          confidence: string | null
          contract_version: string
          correlation_id: string
          created_at: string
          id: string
          model: string
          payload: Json
          provider_used: string
          request_fingerprint: string
          session_id: string
          signals_schema_version: string
          user_id: string
        }
        Insert: {
          confidence?: string | null
          contract_version?: string
          correlation_id: string
          created_at?: string
          id?: string
          model: string
          payload: Json
          provider_used: string
          request_fingerprint: string
          session_id: string
          signals_schema_version?: string
          user_id: string
        }
        Update: {
          confidence?: string | null
          contract_version?: string
          correlation_id?: string
          created_at?: string
          id?: string
          model?: string
          payload?: Json
          provider_used?: string
          request_fingerprint?: string
          session_id?: string
          signals_schema_version?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_interpretations_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "multimodal_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_interpretations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      session_modality_coverage: {
        Row: {
          coverage_ms: number
          created_at: string
          extractor_version: string
          id: string
          modality: string
          outcome: string
          reason: string | null
          session_duration_ms: number
          session_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          coverage_ms?: number
          created_at?: string
          extractor_version?: string
          id?: string
          modality: string
          outcome: string
          reason?: string | null
          session_duration_ms: number
          session_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          coverage_ms?: number
          created_at?: string
          extractor_version?: string
          id?: string
          modality?: string
          outcome?: string
          reason?: string | null
          session_duration_ms?: number
          session_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_modality_coverage_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "multimodal_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_modality_coverage_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      session_participants: {
        Row: {
          entered_count: number
          first_entered_at: string | null
          last_entered_at: string | null
          left_at: string | null
          present: boolean
          role: string
          session_id: string
          user_id: string
        }
        Insert: {
          entered_count?: number
          first_entered_at?: string | null
          last_entered_at?: string | null
          left_at?: string | null
          present?: boolean
          role: string
          session_id: string
          user_id: string
        }
        Update: {
          entered_count?: number
          first_entered_at?: string | null
          last_entered_at?: string | null
          left_at?: string | null
          present?: boolean
          role?: string
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_participants_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "professional_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      session_self_reports: {
        Row: {
          created_at: string
          energy: number | null
          id: string
          mood: number | null
          perceived_anxiety: number | null
          session_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          energy?: number | null
          id?: string
          mood?: number | null
          perceived_anxiety?: number | null
          session_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          energy?: number | null
          id?: string
          mood?: number | null
          perceived_anxiety?: number | null
          session_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_self_reports_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "multimodal_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_self_reports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      session_signal_windows: {
        Row: {
          created_at: string
          end_offset_ms: number
          extractor_version: string
          id: string
          retention_until: string
          session_id: string
          signal_name: string
          start_offset_ms: number
          user_id: string
          value: number
        }
        Insert: {
          created_at?: string
          end_offset_ms: number
          extractor_version?: string
          id?: string
          retention_until?: string
          session_id: string
          signal_name: string
          start_offset_ms: number
          user_id: string
          value: number
        }
        Update: {
          created_at?: string
          end_offset_ms?: number
          extractor_version?: string
          id?: string
          retention_until?: string
          session_id?: string
          signal_name?: string
          start_offset_ms?: number
          user_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "session_signal_windows_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "multimodal_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_signal_windows_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      session_transcript_segments: {
        Row: {
          content: string
          created_at: string
          extractor_version: string
          id: string
          recognized_at_offset_ms: number
          retention_until: string
          segment_index: number
          session_id: string
          speaker: string
          start_offset_ms: number
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          extractor_version?: string
          id?: string
          recognized_at_offset_ms: number
          retention_until?: string
          segment_index: number
          session_id: string
          speaker?: string
          start_offset_ms: number
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          extractor_version?: string
          id?: string
          recognized_at_offset_ms?: number
          retention_until?: string
          segment_index?: number
          session_id?: string
          speaker?: string
          start_offset_ms?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_transcript_segments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "multimodal_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_transcript_segments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      session_transcripts: {
        Row: {
          asr_model: string | null
          asr_quantization: string | null
          asr_runtime: string | null
          asr_runtime_version: string | null
          asr_vad: string | null
          content: string | null
          created_at: string
          deleted_at: string | null
          extractor_version: string
          id: string
          language: string
          session_id: string
          source: string
          status: string
          truncated: boolean
          unavailable_reason: string | null
          updated_at: string
          user_id: string
          voiced_duration_ms: number | null
          word_count: number | null
        }
        Insert: {
          asr_model?: string | null
          asr_quantization?: string | null
          asr_runtime?: string | null
          asr_runtime_version?: string | null
          asr_vad?: string | null
          content?: string | null
          created_at?: string
          deleted_at?: string | null
          extractor_version?: string
          id?: string
          language?: string
          session_id: string
          source?: string
          status?: string
          truncated?: boolean
          unavailable_reason?: string | null
          updated_at?: string
          user_id: string
          voiced_duration_ms?: number | null
          word_count?: number | null
        }
        Update: {
          asr_model?: string | null
          asr_quantization?: string | null
          asr_runtime?: string | null
          asr_runtime_version?: string | null
          asr_vad?: string | null
          content?: string | null
          created_at?: string
          deleted_at?: string | null
          extractor_version?: string
          id?: string
          language?: string
          session_id?: string
          source?: string
          status?: string
          truncated?: boolean
          unavailable_reason?: string | null
          updated_at?: string
          user_id?: string
          voiced_duration_ms?: number | null
          word_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "session_transcripts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "multimodal_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_transcripts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      sharing_permissions: {
        Row: {
          connection_id: string
          data_from: string | null
          data_to: string | null
          expires_at: string | null
          granted_at: string
          id: string
          journal_entry_id: string | null
          permission: string
          revoked_at: string | null
          scope: string
          status: string
          updated_at: string
          valid_from: string | null
        }
        Insert: {
          connection_id: string
          data_from?: string | null
          data_to?: string | null
          expires_at?: string | null
          granted_at?: string
          id?: string
          journal_entry_id?: string | null
          permission?: string
          revoked_at?: string | null
          scope: string
          status?: string
          updated_at?: string
          valid_from?: string | null
        }
        Update: {
          connection_id?: string
          data_from?: string | null
          data_to?: string | null
          expires_at?: string | null
          granted_at?: string
          id?: string
          journal_entry_id?: string | null
          permission?: string
          revoked_at?: string | null
          scope?: string
          status?: string
          updated_at?: string
          valid_from?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sharing_permissions_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "professional_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sharing_permissions_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      sleep_records: {
        Row: {
          created_at: string
          duration_minutes: number | null
          id: string
          night: string
          sleep_quality_score: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          duration_minutes?: number | null
          id?: string
          night: string
          sleep_quality_score?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          duration_minutes?: number | null
          id?: string
          night?: string
          sleep_quality_score?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sleep_records_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      support_facilities: {
        Row: {
          address_complement: string | null
          address_district: string | null
          address_number: string | null
          address_street: string | null
          cnes_code: string
          coordinate_status: string
          latitude: number | null
          longitude: number | null
          municipality_code: string
          municipality_name: string | null
          official_name: string
          official_type_code: string
          phone_digits: string | null
          phone_display: string | null
          postal_code: string | null
          snapshot_id: string
          source_active: boolean | null
          source_updated_at: string | null
          state_code: string
        }
        Insert: {
          address_complement?: string | null
          address_district?: string | null
          address_number?: string | null
          address_street?: string | null
          cnes_code: string
          coordinate_status: string
          latitude?: number | null
          longitude?: number | null
          municipality_code: string
          municipality_name?: string | null
          official_name: string
          official_type_code: string
          phone_digits?: string | null
          phone_display?: string | null
          postal_code?: string | null
          snapshot_id: string
          source_active?: boolean | null
          source_updated_at?: string | null
          state_code: string
        }
        Update: {
          address_complement?: string | null
          address_district?: string | null
          address_number?: string | null
          address_street?: string | null
          cnes_code?: string
          coordinate_status?: string
          latitude?: number | null
          longitude?: number | null
          municipality_code?: string
          municipality_name?: string | null
          official_name?: string
          official_type_code?: string
          phone_digits?: string | null
          phone_display?: string | null
          postal_code?: string | null
          snapshot_id?: string
          source_active?: boolean | null
          source_updated_at?: string | null
          state_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_facilities_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "support_network_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_facilities_snapshot_id_official_type_code_fkey"
            columns: ["snapshot_id", "official_type_code"]
            isOneToOne: false
            referencedRelation: "support_facility_types"
            referencedColumns: ["snapshot_id", "official_type_code"]
          },
        ]
      }
      support_facility_categories: {
        Row: {
          category: string
          confirmed: boolean
          evidence: string
          mapping_version: string
          official_type_code: string
          reviewed_at: string | null
        }
        Insert: {
          category: string
          confirmed?: boolean
          evidence: string
          mapping_version: string
          official_type_code: string
          reviewed_at?: string | null
        }
        Update: {
          category?: string
          confirmed?: boolean
          evidence?: string
          mapping_version?: string
          official_type_code?: string
          reviewed_at?: string | null
        }
        Relationships: []
      }
      support_facility_types: {
        Row: {
          official_type_code: string
          official_type_name: string
          snapshot_id: string
        }
        Insert: {
          official_type_code: string
          official_type_name: string
          snapshot_id: string
        }
        Update: {
          official_type_code?: string
          official_type_name?: string
          snapshot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_facility_types_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "support_network_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      support_network_settings: {
        Row: {
          fixtures_visible: boolean
          license_status: string
          real_import_enabled: boolean
          singleton: boolean
          updated_at: string
        }
        Insert: {
          fixtures_visible?: boolean
          license_status?: string
          real_import_enabled?: boolean
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          fixtures_visible?: boolean
          license_status?: string
          real_import_enabled?: boolean
          singleton?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      support_network_snapshots: {
        Row: {
          accepted_count: number
          activated_at: string | null
          id: string
          imported_at: string
          record_count: number
          rejected_count: number
          schema_version: string
          source: string
          source_identifier: string
          source_reference_date: string
          source_sha256: string
          status: string
        }
        Insert: {
          accepted_count?: number
          activated_at?: string | null
          id?: string
          imported_at?: string
          record_count?: number
          rejected_count?: number
          schema_version: string
          source: string
          source_identifier: string
          source_reference_date: string
          source_sha256: string
          status?: string
        }
        Update: {
          accepted_count?: number
          activated_at?: string | null
          id?: string
          imported_at?: string
          record_count?: number
          rejected_count?: number
          schema_version?: string
          source?: string
          source_identifier?: string
          source_reference_date?: string
          source_sha256?: string
          status?: string
        }
        Relationships: []
      }
      transcript_corrections: {
        Row: {
          corrected_content: string
          created_at: string
          id: string
          original_content: string
          original_source: string
          revision: number
          revoked_at: string | null
          session_id: string
          training_eligible: boolean
          transcript_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          corrected_content: string
          created_at?: string
          id?: string
          original_content: string
          original_source: string
          revision?: number
          revoked_at?: string | null
          session_id: string
          training_eligible?: boolean
          transcript_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          corrected_content?: string
          created_at?: string
          id?: string
          original_content?: string
          original_source?: string
          revision?: number
          revoked_at?: string | null
          session_id?: string
          training_eligible?: boolean
          transcript_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transcript_corrections_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "multimodal_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transcript_corrections_transcript_id_fkey"
            columns: ["transcript_id"]
            isOneToOne: false
            referencedRelation: "session_transcripts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transcript_corrections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          checkin_reminder: boolean
          created_at: string
          goal_reminder: boolean
          primary_goal: string | null
          sessions_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          checkin_reminder?: boolean
          created_at?: string
          goal_reminder?: boolean
          primary_goal?: string | null
          sessions_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          checkin_reminder?: boolean
          created_at?: string
          goal_reminder?: boolean
          primary_goal?: string | null
          sessions_enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_professional_invite: { Args: { p_token: string }; Returns: string }
      accept_professional_invite_code: {
        Args: { p_token: string }
        Returns: {
          connection_id: string
          connection_status: string
          outcome: string
          professional_display_name: string
          professional_slug: string
        }[]
      }
      ai_inference_consent_active: {
        Args: { p_user_id: string }
        Returns: boolean
      }
      apply_automated_verification_for: {
        Args: {
          p_outcome: string
          p_policy_version: string
          p_professional_user_id: string
          p_submission: number
        }
        Returns: string
      }
      appointment_notify: {
        Args: { p_appointment_id: string; p_kind: string; p_user_id: string }
        Returns: undefined
      }
      authorize_professional_session_media: {
        Args: { p_purpose: string; p_session_id: string }
        Returns: {
          closes_at: string
          generation: number
          outcome: string
          role: string
        }[]
      }
      availability_window_overlaps: {
        Args: {
          p_end_minute: number
          p_ends_on: string
          p_from: string
          p_start_minute: number
          p_starts_on: string
          p_timezone: string
          p_to: string
        }
        Returns: boolean
      }
      bump_professional_session_media: {
        Args: { p_reason: string; p_session_id: string }
        Returns: undefined
      }
      cancel_appointment: {
        Args: { p_appointment_id: string; p_reason: string }
        Returns: undefined
      }
      close_appointment: {
        Args: { p_appointment_id: string; p_outcome: string }
        Returns: undefined
      }
      complete_professional_session: {
        Args: { p_session_id: string }
        Returns: undefined
      }
      confirm_appointment: {
        Args: { p_appointment_id: string }
        Returns: undefined
      }
      create_emotional_checkin: { Args: { p_payload: Json }; Returns: string }
      create_emotional_checkin_v2: { Args: { p_payload: Json }; Returns: Json }
      create_emotional_checkin_v3: { Args: { p_payload: Json }; Returns: Json }
      create_help_request: {
        Args: {
          p_body: string
          p_connection_id: string
          p_idempotency_key: string
        }
        Returns: string
      }
      create_professional_invite: {
        Args: never
        Returns: {
          expires_at: string
          invite_id: string
          token: string
        }[]
      }
      decline_professional_invite: {
        Args: { p_token: string }
        Returns: boolean
      }
      delete_cycle_data: { Args: never; Returns: Json }
      delete_professional_availability_exception: {
        Args: { p_exception_id: string }
        Returns: undefined
      }
      directory_normalize: { Args: { p_value: string }; Returns: string }
      due_notification_emails: {
        Args: { p_limit: number; p_timezone: string }
        Returns: {
          event_key: string
          kind: string
          user_id: string
        }[]
      }
      email_deliveries_used_since: {
        Args: { p_since: string }
        Returns: number
      }
      email_delivery_retryable: {
        Args: { p_attempts: number; p_failure_code: string; p_status: string }
        Returns: boolean
      }
      enqueue_notification_email: {
        Args: {
          p_body: string
          p_event_key: string
          p_kind: string
          p_subject: string
          p_transport: string
        }
        Returns: string
      }
      enqueue_notification_email_for: {
        Args: {
          p_body: string
          p_event_key: string
          p_kind: string
          p_subject: string
          p_transport: string
          p_user_id: string
        }
        Returns: string
      }
      enter_professional_session: {
        Args: { p_session_id: string; p_token: string }
        Returns: string
      }
      expire_professional_verifications: { Args: never; Returns: number }
      export_my_verification_evidence: { Args: never; Returns: Json[] }
      finalize_account_deletion: { Args: never; Returns: string }
      get_professional_availability_week: {
        Args: { p_timezone: string; p_week_start: string }
        Returns: Json
      }
      get_professional_directory_profile: {
        Args: { p_slug: string }
        Returns: {
          areas: string[]
          bio: string
          city: string
          council: string
          council_region: string
          display_name: string
          languages: string[]
          modalities: string[]
          registration_number: string
          slug: string
          specialty: string
          state: string
          verified_at: string
        }[]
      }
      get_professional_session: {
        Args: { p_session_id: string }
        Returns: {
          allow_ai_derivation: boolean
          allow_audio: boolean
          allow_professional_transcript_access: boolean
          allow_transcription: boolean
          allow_video: boolean
          appointment_id: string
          capture_count: number
          closes_at: string
          counterpart_name: string
          ends_at: string
          id: string
          me_entered_count: number
          me_present: boolean
          modality: string
          opens_at: string
          other_entered_count: number
          other_present: boolean
          role: string
          starts_at: string
          status: string
          timezone: string
          transcript_available: boolean
        }[]
      }
      get_professional_session_transcript: {
        Args: { p_session_id: string }
        Returns: {
          content: string
          outcome: string
          transcribed_at: string
          word_count: number
        }[]
      }
      get_support_facility: {
        Args: { p_cnes_code: string }
        Returns: {
          address_complement: string
          address_district: string
          address_number: string
          address_street: string
          category: string
          cnes_code: string
          coordinate_status: string
          latitude: number
          longitude: number
          municipality_code: string
          municipality_name: string
          official_name: string
          official_type_code: string
          official_type_name: string
          phone_digits: string
          phone_display: string
          postal_code: string
          source_active: boolean
          source_updated_at: string
          state_code: string
        }[]
      }
      help_request_effective_status: {
        Args: { p_expires_at: string; p_status: string }
        Returns: string
      }
      help_request_notify: {
        Args: { p_kind: string; p_request_id: string; p_user_id: string }
        Returns: undefined
      }
      help_request_professional_can_read: {
        Args: { p_connection_id: string }
        Returns: boolean
      }
      invite_professional: {
        Args: { p_professional_user_id: string }
        Returns: string
      }
      issue_professional_session_credential: {
        Args: { p_session_id: string }
        Returns: string
      }
      leave_professional_session: {
        Args: { p_session_id: string }
        Returns: undefined
      }
      list_my_appointments: {
        Args: { p_since: string }
        Returns: {
          cancel_reason: string
          cancelled_at: string
          cancelled_by_me: boolean
          confirmed_at: string
          connection_id: string
          counterpart_name: string
          counterpart_user_id: string
          ends_at: string
          id: string
          modality: string
          requested_at: string
          role: string
          starts_at: string
          status: string
          timezone: string
        }[]
      }
      list_my_availability_conflicts: {
        Args: never
        Returns: {
          appointment_id: string
          ends_at: string
          exception_id: string
          starts_at: string
          status: string
        }[]
      }
      list_my_connection_professional_names: {
        Args: never
        Returns: {
          connection_id: string
          professional_name: string
        }[]
      }
      list_my_help_request_targets: {
        Args: never
        Returns: {
          connection_id: string
          professional_name: string
          waiting: boolean
        }[]
      }
      list_my_help_requests: {
        Args: never
        Returns: {
          body: string
          connection_id: string
          counterpart_name: string
          created_at: string
          ended_at: string
          expires_at: string
          id: string
          responded_at: string
          role: string
          seen_at: string
          status: string
        }[]
      }
      list_my_professional_invites: {
        Args: never
        Returns: {
          accepted_at: string
          consumed_at: string
          created_at: string
          expires_at: string
          id: string
          opened_at: string
          relationship_id: string
          revoked_at: string
          state: string
        }[]
      }
      list_my_professional_sessions: {
        Args: { p_since: string }
        Returns: {
          appointment_id: string
          closes_at: string
          counterpart_name: string
          ends_at: string
          id: string
          modality: string
          opens_at: string
          role: string
          starts_at: string
          status: string
          timezone: string
        }[]
      }
      list_my_professional_verification_events: {
        Args: never
        Returns: {
          actor_role: string
          from_status: string
          id: string
          occurred_at: string
          reason_code: string
          review_due_at: string
          source: string
          to_status: string
        }[]
      }
      list_my_scheduling_professionals: {
        Args: never
        Returns: {
          connection_id: string
          has_availability: boolean
          professional_name: string
          professional_user_id: string
        }[]
      }
      list_my_verification_evidence: {
        Args: never
        Returns: {
          checked_at: string
          fact_type: string
          source_category: string
          status: string
        }[]
      }
      list_professional_credential_queue: {
        Args: never
        Returns: {
          credential_id: string
          end_year: number
          expires_on: string
          institution: string
          kind: string
          professional_user_id: string
          start_year: number
          title: string
          trust_state: string
          updated_at: string
        }[]
      }
      list_professional_directory_credentials: {
        Args: { p_slug: string }
        Returns: {
          end_year: number
          expires_on: string
          institution: string
          kind: string
          start_year: number
          title: string
          trust_state: string
          verified_at: string
        }[]
      }
      list_professional_open_slots: {
        Args: { p_from: string; p_professional_user_id: string; p_to: string }
        Returns: {
          ends_at: string
          modality: string
          starts_at: string
          timezone: string
        }[]
      }
      list_professional_verification_queue: {
        Args: never
        Returns: {
          council: string
          council_region: string
          professional_user_id: string
          registration_number: string
          specialty: string
          verification_review_due_at: string
          verification_status: string
          verification_updated_at: string
        }[]
      }
      list_professional_week_slots: {
        Args: { p_professional_user_id: string; p_week_start: string }
        Returns: Json
      }
      list_support_facility_types: {
        Args: never
        Returns: {
          category: string
          facility_count: number
          official_type_code: string
          official_type_name: string
        }[]
      }
      list_support_municipalities: {
        Args: never
        Returns: {
          approx_latitude: number
          approx_longitude: number
          facility_count: number
          municipality_code: string
          municipality_name: string
          state_code: string
        }[]
      }
      list_support_municipality_types: {
        Args: { p_municipality_code: string }
        Returns: {
          category: string
          facility_count: number
          official_type_code: string
          official_type_name: string
        }[]
      }
      list_verification_evidence_for_review: {
        Args: { p_professional_user_id: string }
        Returns: {
          assurance: string
          checked_at: string
          confidence: number
          detail: string
          expires_at: string
          fact_type: string
          id: string
          provider: string
          source_type: string
          status: string
          submission: number
        }[]
      }
      mark_in_app_notification_read: {
        Args: { p_notification_id: string }
        Returns: string
      }
      materialize_in_app_notifications: { Args: never; Returns: number }
      materialize_pending_consents: { Args: never; Returns: number }
      my_active_connection_for_directory_slug: {
        Args: { p_slug: string }
        Returns: string
      }
      my_connection_for_directory_slug: {
        Args: { p_slug: string }
        Returns: {
          connection_id: string
          status: string
        }[]
      }
      notification_channel_delivers: {
        Args: { p_channel: string; p_kind: string; p_user_id: string }
        Returns: boolean
      }
      notification_email_dispatcher_healthy: {
        Args: { p_max_age_minutes?: number }
        Returns: boolean
      }
      pause_professional_relationship: {
        Args: { p_connection_id: string }
        Returns: string
      }
      preview_professional_invite: {
        Args: { p_token: string }
        Returns: {
          council: string
          council_region: string
          expires_at: string
          invite_id: string
          professional_display_name: string
          registration_number: string
          specialty: string
        }[]
      }
      professional_access_allowed: {
        Args: {
          p_client_user_id: string
          p_journal_entry_id?: string
          p_scope: string
        }
        Returns: boolean
      }
      professional_access_allowed_on: {
        Args: {
          p_client_user_id: string
          p_from: string
          p_journal_entry_id?: string
          p_scope: string
          p_to: string
        }
        Returns: boolean
      }
      professional_directory_consume: {
        Args: { p_actor: string }
        Returns: undefined
      }
      professional_directory_has_availability: {
        Args: { p_slug: string }
        Returns: boolean
      }
      professional_directory_identity_verified: {
        Args: { p_slug: string }
        Returns: boolean
      }
      professional_effective_verification_status: {
        Args: { p_review_due_at: string; p_status: string }
        Returns: string
      }
      professional_has_published_availability: {
        Args: { p_professional_user_id: string }
        Returns: boolean
      }
      professional_invite_attempts_exceeded: {
        Args: { p_actor: string }
        Returns: boolean
      }
      professional_invite_digest: { Args: { p_token: string }; Returns: string }
      professional_invite_effective_state: {
        Args: { p_expires_at: string; p_state: string }
        Returns: string
      }
      professional_invite_lookup_digest: {
        Args: { p_input: string }
        Returns: string
      }
      professional_invite_new_code: { Args: never; Returns: string }
      professional_invite_record_denied: {
        Args: { p_actor: string }
        Returns: undefined
      }
      professional_invite_resolve: {
        Args: { p_actor: string; p_token: string }
        Returns: {
          accepted_at: string | null
          consumed_at: string | null
          created_at: string
          expired_at: string | null
          expires_at: string
          id: string
          opened_at: string | null
          policy_version: string
          professional_user_id: string
          redeemed_by_user_id: string | null
          relationship_id: string | null
          revoked_at: string | null
          state: string
          token_digest: string
        }
        SetofOptions: {
          from: "*"
          to: "professional_invites"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      professional_relationship_is_active: {
        Args: { p_client_user_id: string }
        Returns: boolean
      }
      professional_reviewer_is_active: {
        Args: { p_user_id: string }
        Returns: boolean
      }
      professional_session_allowed_on: {
        Args: {
          p_client_user_id: string
          p_scope: string
          p_session_id: string
        }
        Returns: boolean
      }
      professional_session_effective_status: {
        Args: { p_closes_at: string; p_opens_at: string; p_status: string }
        Returns: string
      }
      professional_session_event: {
        Args: {
          p_actor: string
          p_detail?: string
          p_event: string
          p_result: string
          p_session: Database["public"]["Tables"]["professional_sessions"]["Row"]
        }
        Returns: undefined
      }
      professional_session_media_generation: {
        Args: { p_session_id: string }
        Returns: number
      }
      professional_slot_offer: {
        Args: {
          p_modality: string
          p_professional_user_id: string
          p_starts_at: string
        }
        Returns: {
          ends_at: string
          timezone: string
        }[]
      }
      professional_trail_append: {
        Args: {
          p_actor_role: string
          p_connection_id: string
          p_event_type: string
          p_scope: string
        }
        Returns: undefined
      }
      professional_verification_is_current: {
        Args: { p_user_id: string }
        Returns: boolean
      }
      professional_verification_notify: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      purge_email_delivery_history: { Args: never; Returns: number }
      purge_expired_journal_entries: { Args: never; Returns: number }
      purge_help_request_content: {
        Args: { p_limit: number }
        Returns: {
          expired: number
          purged: number
        }[]
      }
      purge_professional_invites: { Args: never; Returns: number }
      purge_professional_session_artifacts: {
        Args: never
        Returns: {
          credentials_deleted: number
          events_deleted: number
          sessions_expired: number
        }[]
      }
      record_pending_consent: {
        Args: {
          p_document_version: string
          p_purpose: string
          p_user_id: string
        }
        Returns: boolean
      }
      record_professional_precheck: {
        Args: { p_outcome: string; p_reason_code: string; p_submission: number }
        Returns: string
      }
      record_professional_session_media_event: {
        Args: { p_event: string; p_session_id: string }
        Returns: undefined
      }
      record_verification_evidence_for: {
        Args: {
          p_items: Json
          p_professional_user_id: string
          p_submission: number
        }
        Returns: number
      }
      request_appointment: {
        Args: {
          p_connection_id: string
          p_idempotency_key: string
          p_modality: string
          p_starts_at: string
        }
        Returns: string
      }
      request_professional_connection: {
        Args: { p_slug: string }
        Returns: {
          connection_id: string
          status: string
        }[]
      }
      respond_professional_invitation: {
        Args: { p_accept: boolean; p_connection_id: string }
        Returns: string
      }
      resume_professional_relationship: {
        Args: { p_connection_id: string }
        Returns: string
      }
      review_professional_credential: {
        Args: {
          p_credential_id: string
          p_evidence_digest?: string
          p_source?: string
          p_verified: boolean
        }
        Returns: undefined
      }
      review_professional_verification: {
        Args: {
          p_evidence_digest?: string
          p_professional_user_id: string
          p_reason_code: string
          p_source: string
          p_to_status: string
          p_valid_days?: number
        }
        Returns: string
      }
      revoke_professional_connection: {
        Args: { p_connection_id: string }
        Returns: string
      }
      revoke_professional_invite: {
        Args: { p_invite_id: string }
        Returns: string
      }
      save_cycle_daily_record: { Args: { p_payload: Json }; Returns: string }
      save_cycle_period: { Args: { p_payload: Json }; Returns: string }
      save_journal_entry: { Args: { p_payload: Json }; Returns: string }
      save_professional_availability: {
        Args: { p_rules: Json; p_timezone: string }
        Returns: number
      }
      save_professional_availability_exception: {
        Args: { p_exception: Json; p_timezone: string }
        Returns: string
      }
      save_professional_credential: {
        Args: {
          p_council_region: string
          p_registration_number: string
          p_specialty: string
        }
        Returns: string
      }
      save_professional_week_availability: {
        Args: {
          p_blocks: Json
          p_expected_revision: string
          p_intervals: Json
          p_timezone: string
          p_week_start: string
        }
        Returns: Json
      }
      scheduling_timezone_is_valid: {
        Args: { p_timezone: string }
        Returns: boolean
      }
      scheduling_window_ok: { Args: { p_starts_at: string }; Returns: boolean }
      search_professional_directory: {
        Args: {
          p_area?: string
          p_city?: string
          p_language?: string
          p_modality?: string
          p_page?: number
          p_page_size?: number
          p_query?: string
          p_state?: string
        }
        Returns: {
          areas: string[]
          city: string
          council: string
          council_region: string
          display_name: string
          has_more: boolean
          languages: string[]
          modalities: string[]
          registration_number: string
          slug: string
          specialty: string
          state: string
          verified_at: string
        }[]
      }
      search_support_facilities: {
        Args: {
          p_category?: string
          p_limit?: number
          p_municipality_code: string
          p_official_type_codes?: string[]
          p_offset?: number
        }
        Returns: {
          address_complement: string
          address_district: string
          address_number: string
          address_street: string
          category: string
          cnes_code: string
          coordinate_status: string
          latitude: number
          longitude: number
          municipality_code: string
          municipality_name: string
          official_name: string
          official_type_code: string
          official_type_name: string
          phone_digits: string
          phone_display: string
          postal_code: string
          source_active: boolean
          source_updated_at: string
          state_code: string
        }[]
      }
      seed_notification_preferences: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      session_credential_digest: { Args: { p_token: string }; Returns: string }
      set_ai_inference_consent: { Args: { enabled: boolean }; Returns: string }
      set_cycle_enabled: { Args: { p_enabled: boolean }; Returns: Json }
      set_professional_session_consent: {
        Args: { p_consent: string; p_session_id: string; p_value: boolean }
        Returns: undefined
      }
      set_sharing_data_window: {
        Args: {
          p_connection_id: string
          p_data_from?: string
          p_data_to?: string
          p_journal_entry_id?: string
          p_scope: string
        }
        Returns: string
      }
      set_sharing_grant_validity: {
        Args: {
          p_connection_id: string
          p_journal_entry_id?: string
          p_scope: string
          p_valid_from?: string
          p_valid_until?: string
        }
        Returns: string
      }
      set_sharing_permission: {
        Args: {
          p_connection_id: string
          p_enabled: boolean
          p_expires_at?: string
          p_journal_entry_id?: string
          p_scope: string
        }
        Returns: string
      }
      set_training_consent: { Args: { enabled: boolean }; Returns: string }
      settle_notification_email: {
        Args: {
          p_delivery_id: string
          p_failure_code?: string
          p_succeeded: boolean
        }
        Returns: undefined
      }
      settle_notification_email_for: {
        Args: {
          p_delivery_id: string
          p_failure_code?: string
          p_status: string
        }
        Returns: boolean
      }
      submit_professional_onboarding: {
        Args: never
        Returns: {
          submission: number
          verification_status: string
        }[]
      }
      support_network_activate_snapshot: {
        Args: { p_max_drop_ratio?: number; p_snapshot_id: string }
        Returns: string
      }
      support_network_provenance: {
        Args: never
        Returns: {
          activated_at: string
          age_days: number
          facility_count: number
          imported_at: string
          is_fixture: boolean
          source: string
          source_reference_date: string
        }[]
      }
      support_network_rollback_snapshot: {
        Args: { p_snapshot_id: string }
        Returns: string
      }
      support_network_seal_snapshot: {
        Args: {
          p_record_count: number
          p_rejected_count: number
          p_snapshot_id: string
        }
        Returns: undefined
      }
      support_network_visible_snapshot: { Args: never; Returns: string }
      training_consent_active: { Args: { p_user_id: string }; Returns: boolean }
      transition_help_request: {
        Args: { p_action: string; p_request_id: string }
        Returns: string
      }
      update_emotional_checkin: { Args: { p_payload: Json }; Returns: Json }
      upsert_professional_profile: {
        Args: { p_registration_number: string; p_specialty: string }
        Returns: string
      }
      verification_evidence_accepted: {
        Args: { p_assurance: string; p_fact: string; p_source: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  storage: {
    Tables: {
      buckets: {
        Row: {
          allowed_mime_types: string[] | null
          avif_autodetection: boolean | null
          created_at: string | null
          file_size_limit: number | null
          id: string
          name: string
          owner: string | null
          owner_id: string | null
          public: boolean | null
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string | null
        }
        Insert: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id: string
          name: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
        }
        Update: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id?: string
          name?: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
        }
        Relationships: []
      }
      buckets_analytics: {
        Row: {
          created_at: string
          deleted_at: string | null
          format: string
          id: string
          name: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      buckets_vectors: {
        Row: {
          created_at: string
          id: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      iceberg_namespaces: {
        Row: {
          bucket_name: string
          catalog_id: string
          created_at: string
          id: string
          metadata: Json
          name: string
          updated_at: string
        }
        Insert: {
          bucket_name: string
          catalog_id: string
          created_at?: string
          id?: string
          metadata?: Json
          name: string
          updated_at?: string
        }
        Update: {
          bucket_name?: string
          catalog_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iceberg_namespaces_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "buckets_analytics"
            referencedColumns: ["id"]
          },
        ]
      }
      iceberg_tables: {
        Row: {
          bucket_name: string
          catalog_id: string
          created_at: string
          id: string
          location: string
          name: string
          namespace_id: string
          remote_table_id: string | null
          shard_id: string | null
          shard_key: string | null
          updated_at: string
        }
        Insert: {
          bucket_name: string
          catalog_id: string
          created_at?: string
          id?: string
          location: string
          name: string
          namespace_id: string
          remote_table_id?: string | null
          shard_id?: string | null
          shard_key?: string | null
          updated_at?: string
        }
        Update: {
          bucket_name?: string
          catalog_id?: string
          created_at?: string
          id?: string
          location?: string
          name?: string
          namespace_id?: string
          remote_table_id?: string | null
          shard_id?: string | null
          shard_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iceberg_tables_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "buckets_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "iceberg_tables_namespace_id_fkey"
            columns: ["namespace_id"]
            isOneToOne: false
            referencedRelation: "iceberg_namespaces"
            referencedColumns: ["id"]
          },
        ]
      }
      migrations: {
        Row: {
          executed_at: string | null
          hash: string
          id: number
          name: string
        }
        Insert: {
          executed_at?: string | null
          hash: string
          id: number
          name: string
        }
        Update: {
          executed_at?: string | null
          hash?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      objects: {
        Row: {
          bucket_id: string | null
          created_at: string | null
          id: string
          last_accessed_at: string | null
          metadata: Json | null
          name: string | null
          owner: string | null
          owner_id: string | null
          path_tokens: string[] | null
          updated_at: string | null
          user_metadata: Json | null
          version: string | null
        }
        Insert: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Update: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "objects_bucketId_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads: {
        Row: {
          bucket_id: string
          created_at: string
          id: string
          in_progress_size: number
          key: string
          metadata: Json | null
          owner_id: string | null
          upload_signature: string
          user_metadata: Json | null
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          id: string
          in_progress_size?: number
          key: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature: string
          user_metadata?: Json | null
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          id?: string
          in_progress_size?: number
          key?: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature?: string
          user_metadata?: Json | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads_parts: {
        Row: {
          bucket_id: string
          created_at: string
          etag: string
          id: string
          key: string
          owner_id: string | null
          part_number: number
          size: number
          upload_id: string
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          etag: string
          id?: string
          key: string
          owner_id?: string | null
          part_number: number
          size?: number
          upload_id: string
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          etag?: string
          id?: string
          key?: string
          owner_id?: string | null
          part_number?: number
          size?: number
          upload_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_parts_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "s3_multipart_uploads_parts_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "s3_multipart_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      vector_indexes: {
        Row: {
          bucket_id: string
          created_at: string
          data_type: string
          dimension: number
          distance_metric: string
          id: string
          metadata_configuration: Json | null
          name: string
          updated_at: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          data_type: string
          dimension: number
          distance_metric: string
          id?: string
          metadata_configuration?: Json | null
          name: string
          updated_at?: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          data_type?: string
          dimension?: number
          distance_metric?: string
          id?: string
          metadata_configuration?: Json | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vector_indexes_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets_vectors"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      allow_any_operation: {
        Args: { expected_operations: string[] }
        Returns: boolean
      }
      allow_only_operation: {
        Args: { expected_operation: string }
        Returns: boolean
      }
      can_insert_object: {
        Args: { bucketid: string; metadata: Json; name: string; owner: string }
        Returns: undefined
      }
      extension: { Args: { name: string }; Returns: string }
      filename: { Args: { name: string }; Returns: string }
      foldername: { Args: { name: string }; Returns: string[] }
      get_common_prefix: {
        Args: { p_delimiter: string; p_key: string; p_prefix: string }
        Returns: string
      }
      get_size_by_bucket: {
        Args: never
        Returns: {
          bucket_id: string
          size: number
        }[]
      }
      list_multipart_uploads_with_delimiter: {
        Args: {
          bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_key_token?: string
          next_upload_token?: string
          prefix_param: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
        }[]
      }
      list_objects_with_delimiter: {
        Args: {
          _bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_token?: string
          prefix_param: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      operation: { Args: never; Returns: string }
      search: {
        Args: {
          bucketname: string
          levels?: number
          limits?: number
          offsets?: number
          prefix: string
          search?: string
          sortcolumn?: string
          sortorder?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_by_timestamp: {
        Args: {
          p_bucket_id: string
          p_level: number
          p_limit: number
          p_prefix: string
          p_sort_column: string
          p_sort_column_after: string
          p_sort_order: string
          p_start_after: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_v2: {
        Args: {
          bucket_name: string
          levels?: number
          limits?: number
          prefix: string
          sort_column?: string
          sort_column_after?: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
    }
    Enums: {
      buckettype: "STANDARD" | "ANALYTICS" | "VECTOR"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
  storage: {
    Enums: {
      buckettype: ["STANDARD", "ANALYTICS", "VECTOR"],
    },
  },
} as const
