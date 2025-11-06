-- Add DELETE policy for chat_messages so users can clear their own project chats

CREATE POLICY "Users can delete messages in own projects" 
  ON chat_messages 
  FOR DELETE 
  USING (
    project_id IN (
      SELECT id FROM projects WHERE user_id = auth.uid()
    )
  );

-- Also add UPDATE policy in case it's needed in the future
CREATE POLICY "Users can update messages in own projects" 
  ON chat_messages 
  FOR UPDATE 
  USING (
    project_id IN (
      SELECT id FROM projects WHERE user_id = auth.uid()
    )
  );

