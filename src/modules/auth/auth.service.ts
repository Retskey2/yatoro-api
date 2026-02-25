import { UsersRepository } from "../users/users.repository";
import { users } from "@/database/schema";

type RegisterDTO = Pick<
  typeof users.$inferInsert,
  "email" | "username" | "passwordHash"
> & { password: string };

export class AuthService {
  async register(data: RegisterDTO) {
    const existingUser = await UsersRepository.findByEmail(data.email);
    if (existingUser) {
      throw new Error("Пользователь с таким email уже существует");
    }

    const hashedPassword = await Bun.password.hash(data.password);

    const newUser = await UsersRepository.create({
      email: data.email,
      username: data.username,
      passwordHash: hashedPassword,
    });

    return newUser;
  }

  async login(email: string, passwordToVerify: string) {
    const user = await UsersRepository.findByEmail(email);
    if (!user) {
      throw new Error("Неверный email или пароль");
    }

    const isPasswordValid = await Bun.password.verify(
      passwordToVerify,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      throw new Error("Неверный email или пароль");
    }

    return user;
  }
}
