import { observer } from 'mobx-react-lite'
import { Avatar, Flex, Typography } from 'antd'
import { UserOutlined } from '@ant-design/icons'
import { userStore } from '../stores/userStore'

const { Title } = Typography

const isInTelegram = !!window.Telegram?.WebApp?.initData

export const Header = observer(() => {
  return (
    <Flex align="center" justify="space-between">
      <Title level={3} style={{ margin: 0 }}>
        ОПГ Здоровья
      </Title>
      <Flex align="center" gap={8}>
        <Typography.Text>{userStore.fullName}</Typography.Text>
        <Avatar src={userStore.avatarUrl} icon={<UserOutlined />}>
          {userStore.avatarUrl ? null : userStore.initials}
        </Avatar>
        {!isInTelegram && (
          <Typography.Link onClick={() => userStore.logout()}>Выйти</Typography.Link>
        )}
      </Flex>
    </Flex>
  )
})
