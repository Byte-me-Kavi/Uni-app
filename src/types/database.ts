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
      add_comment: {
        Args: {
          p_body: string
          p_parent_id?: string
          p_question?: string
          p_resource_id: string
        }
        Returns: Json
      }
      add_group_members: {
        Args: { p_conversation_id: string; p_member_ids: string[] }
        Returns: Json
      }
      app_config: { Args: never; Returns: Json }
      ban_uploader: {
        Args: { p_days?: number; p_reason: string; p_user_id: string }
        Returns: undefined
      }
      batch_suggestion: { Args: never; Returns: Json }
      begin_avatar_upload: { Args: never; Returns: string }
      begin_chat_upload: {
        Args: {
          p_conversation_id: string
          p_kind: string
          p_mime: string
          p_size: number
        }
        Returns: Json
      }
      begin_publish: {
        Args: {
          p_category: string
          p_message_id: string
          p_module_id: number
          p_paper_year?: number
          p_scope?: string
          p_title?: string
        }
        Returns: Json
      }
      begin_resource_upload: {
        Args: {
          p_category: string
          p_mime: string
          p_module_id: number
          p_paper_year?: number
          p_scope?: string
          p_size: number
          p_title: string
        }
        Returns: Json
      }
      begin_sticker_upload: {
        Args: { p_animated: boolean; p_hash: string; p_size: number }
        Returns: Json
      }
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
      cancel_kuppi: {
        Args: { p_reason?: string; p_session_id: string }
        Returns: Json
      }
      cancel_rsvp: { Args: { p_session_id: string }; Returns: Json }
      chat_file_checked: {
        Args: {
          p_message_id: string
          p_ok: boolean
          p_reason?: string
          p_sha256?: string
        }
        Returns: undefined
      }
      chat_files: {
        Args: {
          p_before?: string
          p_conversation_id: string
          p_kind: string
          p_limit?: number
        }
        Returns: {
          attachment: Json
          body: string
          created_at: string
          id: string
          kind: string
          sender_name: string
        }[]
      }
      chat_folders: {
        Args: { p_conversation_id: string; p_message_ids: string[] }
        Returns: Json
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
          attachment: Json
          body: string
          created_at: string
          deleted: boolean
          edited_at: string
          forwarded: boolean
          id: string
          kind: string
          link: Json
          mentions: string[]
          reply: Json
          reply_to_id: string
          sender_avatar: string
          sender_id: string
          sender_name: string
        }[]
      }
      chat_settings: { Args: { p_conversation_id: string }; Returns: Json }
      close_kuppi_request: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      comments: {
        Args: { p_limit?: number; p_question?: string; p_resource_id: string }
        Returns: Json
      }
      commit_sticker: {
        Args: {
          p_animated: boolean
          p_hash: string
          p_size: number
          p_user_id: string
        }
        Returns: string
      }
      create_group: {
        Args: { p_member_ids: string[]; p_title: string }
        Returns: Json
      }
      create_kuppi: {
        Args: {
          p_capacity: number
          p_description?: string
          p_meeting_url?: string
          p_minutes: number
          p_mode: string
          p_module_id: number
          p_request_id?: string
          p_scope?: string
          p_starts_at: string
          p_title: string
          p_venue?: string
        }
        Returns: Json
      }
      delete_comment: { Args: { p_comment_id: string }; Returns: undefined }
      delete_message: {
        Args: {
          p_conversation_id: string
          p_for_everyone: boolean
          p_message_id: string
        }
        Returns: undefined
      }
      drop_push_tokens: { Args: { p_tokens: string[] }; Returns: undefined }
      edit_comment: {
        Args: { p_body: string; p_comment_id: string }
        Returns: Json
      }
      edit_message: {
        Args: {
          p_body: string
          p_conversation_id: string
          p_message_id: string
        }
        Returns: string
      }
      explore: {
        Args: {
          p_before?: string
          p_category?: string
          p_limit?: number
          p_module_id?: number
          p_national?: boolean
          p_query?: string
        }
        Returns: Json
      }
      explore_overview: { Args: never; Returns: Json }
      find_modules: {
        Args: { p_query: string }
        Returns: {
          batches: number
          code: string
          id: number
          name: string
        }[]
      }
      find_subjects: {
        Args: { p_query: string }
        Returns: {
          id: number
          name: string
        }[]
      }
      finish_resource: {
        Args: {
          p_ok: boolean
          p_reason?: string
          p_resource_id: string
          p_sha256?: string
          p_size?: number
        }
        Returns: Json
      }
      join_batch: {
        Args: {
          p_intake_year?: number
          p_programme_id?: number
          p_programme_name?: string
        }
        Returns: Json
      }
      kuppi: { Args: { p_session_id: string }; Returns: Json }
      kuppi_list: {
        Args: {
          p_after?: string
          p_limit?: number
          p_module_id?: number
          p_scope?: string
        }
        Returns: Json
      }
      kuppi_requests: {
        Args: { p_module_id?: number; p_scope?: string }
        Returns: Json
      }
      leave_group: { Args: { p_conversation_id: string }; Returns: undefined }
      library: {
        Args: {
          p_before?: string
          p_category?: string
          p_limit?: number
          p_module_id: number
        }
        Returns: Json
      }
      library_item: { Args: { p_message_id: string }; Returns: Json }
      library_overview: { Args: never; Returns: Json }
      library_search: {
        Args: { p_limit?: number; p_query: string }
        Returns: Json
      }
      library_to_sort: {
        Args: { p_before?: string; p_limit?: number }
        Returns: Json
      }
      mark_delivered: {
        Args: { p_conversation_id: string; p_up_to: string }
        Returns: undefined
      }
      mark_read: {
        Args: { p_conversation_id: string; p_up_to: string }
        Returns: string
      }
      media_access: { Args: { p_paths: string[] }; Returns: string[] }
      merge_modules: {
        Args: { p_from: number; p_into: number }
        Returns: undefined
      }
      merge_subjects: {
        Args: { p_from: number; p_into: number }
        Returns: undefined
      }
      message_previews: { Args: never; Returns: boolean }
      module_subject: { Args: { p_module_id: number }; Returns: Json }
      my_account: { Args: never; Returns: Json }
      my_chats: {
        Args: never
        Returns: {
          announcement_only: boolean
          archived: boolean
          conversation_id: string
          created_at: string
          kind: string
          last_message_at: string
          last_message_preview: string
          last_sender_id: string
          last_sender_name: string
          list_pinned_at: string
          member_count: number
          muted: boolean
          my_last_read_at: string
          my_role: string
          other_avatar_path: string
          other_delivered_at: string
          other_last_read_at: string
          other_user_id: string
          pinned: Json
          request: string
          slow_mode_seconds: number
          title: string
          unread: number
        }[]
      }
      my_exams: { Args: never; Returns: Json }
      my_home: { Args: never; Returns: Json }
      my_modules: { Args: never; Returns: Json }
      my_stickers: {
        Args: never
        Returns: {
          animated: boolean
          favourite: boolean
          mine: boolean
          sticker: string
          used_at: string
        }[]
      }
      needs_text: { Args: { p_sha256: string }; Returns: boolean }
      notification_settings: { Args: never; Returns: Json }
      organise_item: {
        Args: {
          p_category?: string
          p_hidden?: boolean
          p_message_id: string
          p_module_id?: number
          p_pinned?: boolean
        }
        Returns: Json
      }
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
      pending_resource: { Args: { p_resource_id: string }; Returns: Json }
      person: { Args: { p_user_id: string }; Returns: Json }
      pin_message: {
        Args: { p_conversation_id: string; p_message_id: string }
        Returns: Json
      }
      poll_results: {
        Args: { p_conversation_id: string; p_message_ids: string[] }
        Returns: {
          counts: Json
          message_id: string
          mine: number[]
          voters: number
        }[]
      }
      poll_voters: {
        Args: { p_conversation_id: string; p_message_id: string }
        Returns: {
          avatar_path: string
          full_name: string
          option: number
          user_id: string
          voted_at: string
        }[]
      }
      presence: { Args: { p_user_id: string }; Returns: Json }
      privacy_extras: { Args: never; Returns: Json }
      push_batch: {
        Args: { p_created_at: string; p_message_id: string }
        Returns: Json
      }
      react: {
        Args: {
          p_conversation_id: string
          p_emoji: string
          p_message_id: string
        }
        Returns: undefined
      }
      reaction_details: {
        Args: { p_conversation_id: string; p_message_id: string }
        Returns: {
          avatar_path: string
          emoji: string
          full_name: string
          user_id: string
        }[]
      }
      reactions: {
        Args: { p_conversation_id: string; p_message_ids: string[] }
        Returns: {
          count: number
          emoji: string
          message_id: string
          mine: boolean
        }[]
      }
      register_push_token: {
        Args: { p_platform: string; p_token: string }
        Returns: undefined
      }
      remove_exam: { Args: { p_exam_id: string }; Returns: Json }
      remove_group_member: {
        Args: { p_conversation_id: string; p_user_id: string }
        Returns: undefined
      }
      remove_resource: { Args: { p_resource_id: string }; Returns: undefined }
      rename_module: {
        Args: { p_module_id: number; p_name: string }
        Returns: Json
      }
      report: {
        Args: {
          p_category: string
          p_conversation_id?: string
          p_details?: string
          p_kind: string
          p_target_id: string
        }
        Returns: string
      }
      report_categories: {
        Args: never
        Returns: {
          code: string
          label: string
        }[]
      }
      report_comment: {
        Args: { p_category: string; p_comment_id: string; p_details?: string }
        Returns: string
      }
      report_kuppi: {
        Args: { p_category: string; p_details?: string; p_session_id: string }
        Returns: string
      }
      report_kuppi_request: {
        Args: { p_category: string; p_details?: string; p_request_id: string }
        Returns: string
      }
      report_resource: {
        Args: { p_category: string; p_details?: string; p_resource_id: string }
        Returns: string
      }
      request_kuppi: {
        Args: {
          p_details?: string
          p_module_id: number
          p_scope?: string
          p_topic: string
        }
        Returns: Json
      }
      resource: { Args: { p_resource_id: string }; Returns: Json }
      respond_request: {
        Args: { p_accept: boolean; p_conversation_id: string }
        Returns: string
      }
      reveal_link: { Args: { p_session_id: string }; Returns: Json }
      review_account: {
        Args: { p_decision: string; p_reason?: string; p_user_id: string }
        Returns: string
      }
      rsvp: { Args: { p_session_id: string }; Returns: Json }
      save_semester: {
        Args: { p_items: Json; p_semester: number; p_year: number }
        Returns: Json
      }
      save_sticker: {
        Args: { p_favourite?: boolean; p_mine?: boolean; p_sticker: string }
        Returns: undefined
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
      semester_plan: {
        Args: { p_semester: number; p_year: number }
        Returns: Json
      }
      send_message: {
        Args: {
          p_attachment?: Json
          p_body?: string
          p_conversation_id: string
          p_forward_from?: string
          p_id: string
          p_kind?: string
          p_link?: Json
          p_mentions?: string[]
          p_reply_to_id?: string
        }
        Returns: Json
      }
      set_batch_term: {
        Args: { p_semester: number; p_year: number }
        Returns: Json
      }
      set_chat_state: {
        Args: {
          p_archived?: boolean
          p_conversation_id: string
          p_pinned?: boolean
        }
        Returns: undefined
      }
      set_exam: {
        Args: {
          p_kind: string
          p_module_id: number
          p_starts_at: string
          p_venue?: string
        }
        Returns: Json
      }
      set_findable_by: { Args: { p_findable_by: string }; Returns: string }
      set_member_role: {
        Args: { p_conversation_id: string; p_role: string; p_user_id: string }
        Returns: undefined
      }
      set_message_previews: { Args: { p_on: boolean }; Returns: boolean }
      set_module_choice: {
        Args: { p_choice: string; p_module_id: number }
        Returns: Json
      }
      set_module_subject: {
        Args: { p_module_id: number; p_subject: string }
        Returns: Json
      }
      set_muted: {
        Args: { p_conversation_id: string; p_hours?: number; p_on: boolean }
        Returns: string
      }
      set_my_avatar: { Args: { p_path: string }; Returns: string }
      set_my_name: { Args: { p_full_name: string }; Returns: string }
      set_presence: { Args: { p_active: boolean }; Returns: undefined }
      set_quiet_hours: {
        Args: { p_enabled: boolean; p_end?: number; p_start?: number }
        Returns: Json
      }
      set_show_last_seen: { Args: { p_on: boolean }; Returns: boolean }
      star_message: {
        Args: { p_conversation_id: string; p_message_id: string; p_on: boolean }
        Returns: undefined
      }
      starred_messages: {
        Args: { p_before?: string; p_limit?: number }
        Returns: {
          attachment: Json
          body: string
          chat_kind: string
          chat_title: string
          conversation_id: string
          created_at: string
          id: string
          kind: string
          link: Json
          sender_avatar: string
          sender_id: string
          sender_name: string
          starred_at: string
        }[]
      }
      start_direct: { Args: { p_user_id: string }; Returns: Json }
      store_file_text: {
        Args: { p_sha256: string; p_text: string }
        Returns: undefined
      }
      tag_item: {
        Args: { p_category?: string; p_message_id: string; p_module_id: number }
        Returns: undefined
      }
      tag_message: {
        Args: {
          p_category?: string
          p_conversation_id: string
          p_message_id: string
          p_module_id: number
        }
        Returns: undefined
      }
      unblock_user: { Args: { p_user_id: string }; Returns: undefined }
      unregister_push_token: { Args: { p_token: string }; Returns: undefined }
      update_bio: { Args: { p_bio: string }; Returns: string }
      update_chat_settings: {
        Args: {
          p_announcement_only?: boolean
          p_conversation_id: string
          p_slow_mode_seconds?: number
          p_title?: string
        }
        Returns: Json
      }
      update_privacy: {
        Args: { p_findable_by?: string; p_who_can_message?: string }
        Returns: Json
      }
      vote_comment: {
        Args: { p_comment_id: string; p_on: boolean }
        Returns: Json
      }
      vote_kuppi_request: {
        Args: { p_on: boolean; p_request_id: string }
        Returns: Json
      }
      vote_poll: {
        Args: {
          p_conversation_id: string
          p_message_id: string
          p_options: number[]
        }
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
