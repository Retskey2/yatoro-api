import { UsersRepository } from "./users.repository";

export class UsersService {
  async getUserProfile(userId: number) {
    const user = await UsersRepository.findById(userId);

    if (!user) {
      throw new Error("Пользователь не найден");
    }

    const { passwordHash, ...safeUser } = user;

    return safeUser;
  }
}
