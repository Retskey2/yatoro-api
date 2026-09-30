import { NotFoundError } from "@/shared/errors";
import { toPublicUser } from "./users.model";
import { UsersRepository } from "./users.repository";

export class UsersService {
  async getPublicProfile(userId: number) {
    const user = await UsersRepository.findById(userId);

    if (!user) {
      throw new NotFoundError("Пользователь не найден");
    }

    return toPublicUser(user);
  }
}
