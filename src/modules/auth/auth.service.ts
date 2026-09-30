import { isUniqueViolation } from "@/database/errors";
import { ConflictError, UnauthorizedError } from "@/shared/errors";
import { UsersRepository } from "../users/users.repository";
import { normalizeEmail } from "./auth.model";

type RegisterDTO = {
  username: string;
  email: string;
  password: string;
};

// Verified against when the email is unknown, so the response time
// does not reveal whether an account exists
const DUMMY_HASH = await Bun.password.hash("timing-attack-mitigation");

export class AuthService {
  async register(data: RegisterDTO) {
    const email = normalizeEmail(data.email);
    const username = data.username.trim();

    if (await UsersRepository.findByEmail(email)) {
      throw new ConflictError("Пользователь с таким email уже существует");
    }

    if (await UsersRepository.findByUsername(username)) {
      throw new ConflictError("Имя пользователя уже занято");
    }

    const passwordHash = await Bun.password.hash(data.password);

    try {
      return await UsersRepository.create({ email, username, passwordHash });
    } catch (error) {
      // Lost a race with a concurrent registration: the unique index has the final word
      if (isUniqueViolation(error)) {
        throw new ConflictError("Пользователь с таким email или именем уже существует");
      }
      throw error;
    }
  }

  async login(email: string, password: string) {
    const user = await UsersRepository.findByEmail(normalizeEmail(email));
    const isPasswordValid = await Bun.password.verify(password, user?.passwordHash ?? DUMMY_HASH);

    if (!user || !isPasswordValid) {
      throw new UnauthorizedError("Неверный email или пароль");
    }

    return user;
  }
}
