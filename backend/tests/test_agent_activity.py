from app import progress


def setup_function():
    progress.reset_activity()


def test_steps_are_attributed_to_agents_without_a_listener():
    with progress.step('物流：检查配送资料、门尺寸与装卸条件'):
        board = progress.activity()
        assert board['agents']['LogisticsAgent']['status'] == 'working'
        assert board['agents']['LogisticsAgent']['step'].startswith('物流：')
    board = progress.activity()
    logistics = board['agents']['LogisticsAgent']
    assert logistics['status'] == 'idle'
    assert logistics['last']['status'] == 'done'
    assert board['recent'][0]['agent'] == 'LogisticsAgent'


def test_label_mapping_matches_report_agents():
    assert progress.agent_of('估价 Agent：选择处理工具') == 'PricingAgent'
    assert progress.agent_of('结算：核对送达记录、交付问题与留置资金') == 'PaymentAgent'
    assert progress.agent_of('审计：整理经营汇总') == 'AuditReportingAgent'
    assert progress.agent_of('监督 Agent：整理可选方案') == 'SupervisionAgent'
    assert progress.agent_of('业务规则校验') == 'BusinessRules'
    assert progress.agent_of('保存结果与账本（提交后生效）') is None


def test_failed_step_is_recorded_and_task_is_earliest_running_label():
    progress.emit(None, 'a', '审核 Agent：审核照片与资料', 'running')
    progress.emit(None, 'b', '审核 Agent：检查照片', 'running')
    listing = progress.activity()['agents']['ListingAgent']
    assert listing['task'] == '审核 Agent：审核照片与资料' and listing['step'] == '审核 Agent：检查照片'
    progress.emit(None, 'b', '审核 Agent：检查照片', 'failed', 12)
    progress.emit(None, 'a', '审核 Agent：审核照片与资料', 'done', 30)
    board = progress.activity()
    assert board['agents']['ListingAgent']['status'] == 'idle'
    assert [e['status'] for e in board['recent'][:2]] == ['done', 'failed']
