export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  api: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      app_config: { Args: never; Returns: Json }
      batch_suggestion: { Args: never; Returns: Json }
      begin_avatar_upload: { Args: never; Returns: string }
      block_user: { Args: { p_user_id: string }; Returns: undefined }
      blocked_users: {
        Args: never
        Returns: {
          avatar_path: string
          blocked_at: string
          full_name: string
          institution: string
          user_id: string
        }[]
      }
      chat_members: {
        Args: {
          p_after_id?: string
          p_after_name?: string
          p_conversation_id: string
          p_limit?: number
        }
        Returns: {
          avatar_path: string
          full_name: string
          institution: string
          is_admin: boolean
          user_id: string
        }[]
      }
      chat_messages: {
        Args: {
          p_after?: string
          p_before?: string
          p_conversation_id: string
          p_limit?: number
        }
        Returns: {
          body: string
          created_at: string
          deleted: boolean
          edited_at: string
          id: string
          reply_to_id: string
          sender_avatar: string
          sender_id: string
          sender_name: string
        }[]
      }
      drop_push_tokens: { Args: { p_tokens: string[] }; Returns: undefined }
      join_batch: {
        Args: {
          p_intake_year?: number
          p_programme_id?: number
          p_programme_name?: string
        }
        Returns: Json
      }
      mark_read: {
        Args: { p_conversation_id: string; p_up_to: string }
        Returns: string
      }
      message_previews: { Args: never; Returns: boolean }
      my_account: { Args: never; Returns: Json }
      my_chats: {
        Args: never
        Returns: {
          conversation_id: string
          created_at: string
          kind: string
          last_message_at: string
          last_message_preview: string
          last_sender_id: string
          last_sender_name: string
          member_count: number
          muted: boolean
          my_last_read_at: string
          other_avatar_path: string
          other_last_read_at: string
          other_user_id: string
          request: string
          title: string
          unread: number
        }[]
      }
      my_home: { Args: never; Returns: Json }
      pending_accounts: {
        Args: {
          p_after_registered_at?: string
          p_after_user_id?: string
          p_institution_id?: number
          p_limit?: number
        }
        Returns: {
          email: string
          email_confirmed_at: string
          full_name: string
          institution_id: number
          institution_name: string
          registered_at: string
          user_id: string
        }[]
      }
      person: { Args: { p_user_id: string }; Returns: Json }
      push_batch: {
        Args: { p_created_at: string; p_message_id: string }
        Returns: Json
      }
      register_push_token: {
        Args: { p_platform: string; p_token: string }
        Returns: undefined
      }
      respond_request: {
        Args: { p_accept: boolean; p_conversation_id: string }
        Returns: string
      }
      review_account: {
        Args: { p_decision: string; p_reason?: string; p_user_id: string }
        Returns: string
      }
      search_people: {
        Args: { p_query: string }
        Returns: {
          avatar_path: string
          blocked: boolean
          corrected: boolean
          full_name: string
          institution: string
          intake_year: number
          programme: string
          relation: string
          user_id: string
        }[]
      }
      search_programmes: {
        Args: { p_intake_year?: number; p_query: string }
        Returns: {
          id: number
          members: number
          name: string
        }[]
      }
      send_message: {
        Args: {
          p_body: string
          p_conversation_id: string
          p_id: string
          p_reply_to_id?: string
        }
        Returns: Json
      }
      set_findable_by: { Args: { p_findable_by: string }; Returns: string }
      set_message_previews: { Args: { p_on: boolean }; Returns: boolean }
      set_muted: {
        Args: { p_conversation_id: string; p_hours?: number; p_on: boolean }
        Returns: string
      }
      set_my_avatar: { Args: { p_path: string }; Returns: string }
      set_my_name: { Args: { p_full_name: string }; Returns: string }
      start_direct: { Args: { p_user_id: string }; Returns: Json }
      unblock_user: { Args: { p_user_id: string }; Returns: undefined }
      unregister_push_token: { Args: { p_token: string }; Returns: undefined }
      update_bio: { Args: { p_bio: string }; Returns: string }
      update_privacy: {
        Args: { p_findable_by?: string; p_who_can_message?: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  api: {
    Enums: {},
  },
} as const
