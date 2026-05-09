export class LoginRequestDto {
  serverUrl?: string;
  email: string;
  password: string;
}

export class LoginResponseDto {
  token: string;
  user: {
    id: string;
    email: string;
    role: "admin" | "member";
    teamId: string;
    teamName: string;
  };
}
