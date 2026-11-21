import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service.js';

@ApiTags('App')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'Greeting (sample endpoint)' })
  @ApiOkResponse({
    description: 'A plain-text greeting',
    content: {
      'text/html': { schema: { type: 'string', example: 'Hello World!' } },
    },
  })
  getHello(): string {
    return this.appService.getHello();
  }
}
