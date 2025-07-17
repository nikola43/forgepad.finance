import { Avatar } from "@mui/material";
import { FILE_ENDPOINT } from "@/config";

export default function TokenLogo({ logo, size, style }: { logo: string; size?: string | number; style?: any }) {
    return (
        <Avatar
            src={`${FILE_ENDPOINT}/${logo}`}
            sx={{
                width: size ?? '120px', 
                height: size ?? '120px',
                borderRadius: "12px",
                objectFit: 'cover',
                ...style,
            }}
        />
    );
}
