'use client'
import { Box, Typography, styled } from "@mui/material";
import SearchIcon from '@mui/icons-material/Search';
import type { ReactNode } from "react";

const Container = styled(Box)`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  text-align: center;
  gap: 16px;
`;

const IconWrapper = styled(Box)`
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: rgba(191, 209, 67, 0.06);
  border: 1px solid rgba(191, 209, 67, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
`;

interface EmptyStateProps {
  icon?: ReactNode;
  title?: string;
  description?: string;
  action?: React.ReactNode;
}

export default function EmptyState({ icon = <SearchIcon sx={{ fontSize: 32, color: 'var(--muted)' }} />, title = "No bouts yet. The card is yours to book.", description, action }: EmptyStateProps) {
  return (
    <Container>
      <IconWrapper>{icon}</IconWrapper>
      <Typography fontSize={18} fontWeight={700} color="var(--text-primary)" fontFamily="var(--font-display)">
        {title}
      </Typography>
      {description && (
        <Typography fontSize={14} color="var(--text-muted)" maxWidth={400}>
          {description}
        </Typography>
      )}
      {action}
    </Container>
  );
}
