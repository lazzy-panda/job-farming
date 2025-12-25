import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ProxiesService } from './proxies.service';

@Controller('proxies')
export class ProxiesController {
  constructor(private readonly service: ProxiesService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Post()
  create(
    @Body()
    body: {
      host: string;
      port: number;
      username?: string;
      password?: string;
      active?: boolean;
    },
  ) {
    return this.service.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

