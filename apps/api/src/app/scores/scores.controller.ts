import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ScoresService } from './scores.service';

@Controller('scores')
export class ScoresController {
  constructor(private readonly service: ScoresService) {}

  @Get()
  list(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.list(from, to);
  }

  @Get('summary')
  summary() {
    return this.service.summary();
  }

  @Post()
  create(@Body() body: { type: string; note?: string; date?: string }) {
    return this.service.create(body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
