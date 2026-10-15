package io.dbaligner;

/** 比较入口；现有 MySQL 计划行为保持不变。 */
public final class Planner extends MySqlPlanner {
  private final PostgresPlanner postgres = new PostgresPlanner();

  @Override
  void structure(
      Model.TargetPlan target,
      Model.Table source,
      Model.Table before,
      Model.StructureOptions options) {
    if (target.ref.schema() != null) postgres.structure(target, source, before, options);
    else super.structure(target, source, before, options);
  }

  @Override
  protected void data(
      Model.TargetPlan target,
      Model.Table source,
      Model.Table before,
      java.util.List<String> keys,
      boolean structure) {
    if (target.ref.schema() != null) postgres.data(target, source, before, keys);
    else super.data(target, source, before, keys, structure);
  }

  public Planner(Database db) {
    super(db);
  }
}
